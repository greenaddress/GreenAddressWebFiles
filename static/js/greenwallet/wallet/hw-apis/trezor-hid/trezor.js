'use strict';

var util = require('util'),
    crypto = require('crypto'),
    unorm = require('unorm'),
    console = require('console'),
    Promise = require('promise'),
    _root = require('./messages_proto'),
    ByteBuffer = require("bytebuffer"),
    EventEmitter = require('events').EventEmitter;

var CONFIG_URL = '/data/plugin/config_signed.bin';

module.exports.ByteBuffer = ByteBuffer;

//
// Trezor
//
var Trezor = module.exports.Trezor = function (hidImpl) {
    hidImpl = hidImpl || 'chrome';
    if (hidImpl === 'node') {
        this.hid = require('../node-hid-chrome-wrapper');
    } else if (hidImpl === 'chrome') {
        this.hid = chrome.hid;
    } else {
        throw new Error('hidImpl must be "chrome" or "node"');
    }
};

// Returns the plugin version.
Trezor.prototype.version = function () {
    return this._plugin.version;
};

// Returns the list of connected Trezor devices.
Trezor.prototype.devices = function () {
    var self = this;
    return new Promise(function(resolve, reject) {
        self.hid.getDevices(
            {filters:[
                    {vendorId: 0x2B24, productId: 0x0001},
                    {vendorId: 0x534c, productId: 0x0001}
                ]},
            function(devices) {
                console.log("devices = " + devices);
                if (!devices || devices.length == 0) {
                    reject("No device found.");
                } else {
                    // TODO: handle multiple devices
                    resolve(devices);
                }
            });
    });
};

// BIP32 CKD
Trezor.prototype.deriveChildNode = function (node, n) {
    var child = this._plugin.deriveChildNode(node, n);
    child.path = node.path.concat([n]);
    return child;
};

// Opens a given device and returns a Session object.
Trezor.prototype.open = function (device) {
    var self = this;
    return new Promise(function(resolve, reject) {
        self.hid.connect(device.deviceId, function(connection) {
            if (global.chrome && chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
            } else {
                var session = new Session(
                    self.hid,
                    connection.connectionId,
                    device.collections === undefined ? false : device.collections[0].reportIds.length !== 0
                );
                resolve(session);
            }
        });
    });
};

//
// Trezor device session handle. Acts as a event emitter.
//
// Events:
//
//  send: type, message
//  receive: type, message
//  error: error
//
//  button: code
//  word: callback(error, word)
//  pin: type, callback(error, pin)
//  passphrase: callback(error, passphrase)
//
var Session = function (hid, connectionId, hasReportId) {
    EventEmitter.call(this);
    this.hid = hid;
    this._connectionId = connectionId;
    this._hasReportId = hasReportId;
    this._types = {};
    for (var k in _root.MessageType) {
        if (k.indexOf("MessageType_") == 0) {
            this._types[_root.MessageType[k]] = k.split("_")[1];
        }
    }
};

util.inherits(Session, EventEmitter);

// Closes the session and the HID device.
Session.prototype.close = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        console.log('[trezor] Closing');
        self._plugin.close(self._device, {
            success: resolve,
            error: reject
        });
    });
};

Session.prototype.initialize = function () {
    var self = this;
    return self.sendFeatureReport(0x41, 0x01).then(function() {  // enable UART
        return self.sendFeatureReport(0x43, 0x03);  // purge TX/RX FIFOs
    }).then(function() {
        return self.send(
            63,
            self.serializeMessageForTransport(new _root.Initialize(), 0));
    }).then(function() {
        return self.receiveMessage();
    });
};

function padByteArray(sequence, size) {
    var newArray = new Uint8Array(size);
    newArray.set((sequence.slice || sequence.subarray).apply(sequence, [0, size]));
    return newArray;
}

Session.prototype.sendFeatureReport = function(reportId, value) {
    var self = this;
    return new Promise(function(resolve, reject) {
        var data = padByteArray([value], 1);
        self.hid.sendFeatureReport(
            self._connectionId,
            reportId,
            data.buffer,
            function() {
                // Ignore failure because the device is bad at HID.
                resolve();
            });
    });
}

Session.prototype.send = function(reportId, arrayBuffer) {
    var self = this;

    var data = padByteArray(arrayBuffer, 63);

    var next = Promise.resolve();
    while (arrayBuffer.byteLength) {
        (function(data) {
            next = next.then(function() {
                return new Promise(function (resolve, reject) {
                    var buf = data.buffer;
                    if (!self._hasReportId) {
                        var newArray = new Uint8Array(64);
                        newArray[0] = 63;
                        newArray.set(new Uint8Array(buf), 1);
                        buf = newArray.buffer;
                    }
                    self.hid.send(self._connectionId, self._hasReportId ? reportId : 0,
                        buf, function() {
                            if (global.chrome && chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError.message);
                            } else {
                                resolve();
                            }
                        });
                    });
                });
        })(padByteArray(arrayBuffer, 63));
        arrayBuffer = arrayBuffer.subarray(63);
    }
    return next;
}

Session.prototype.receive = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
        self.hid.receive(self._connectionId, function(reportId, data) {
            if (global.chrome && chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
            } else {
                if (!self._hasReportId) data = data.slice(1);
                resolve({id: reportId, data: data});
            }
        });
    });
}

// Format is (big-endian)...
//  - ASCII ##
//  - unsigned short, message type (protocol buffer index)
//  - unsigned long, message length
//  - the message (if any)
Session.prototype.serializeMessageForTransport = function(msg, msg_type) {
    var msg_ab = new Uint8Array(msg.encodeAB());
    var header_size = 1 + 1 + 4 + 2;
    var full_size = header_size + msg_ab.length;
    var msg_full = new ByteBuffer(header_size + full_size);
    msg_full.writeByte(0x23);
    msg_full.writeByte(0x23);
    msg_full.writeUint16(msg_type);
    msg_full.writeUint32(msg_ab.length);
    msg_full.append(msg_ab);
    return new Uint8Array(msg_full.buffer);
}

Session.prototype.receiveMoreOfMessageBody = function(messageBuffer, messageSize) {
    var self = this;
    return new Promise(function(resolve, reject) {
        if (messageBuffer.offset >= messageSize) {
            resolve(messageBuffer);
        } else {
            self.receive().then(function(report) {
                if (report == null || report.data == null) {
                    reject("received no data from device");
                } else {
                    messageBuffer.append(report.data);
                    self.receiveMoreOfMessageBody(messageBuffer,
                        messageSize).then(function(message) {
                            resolve(message);
                        });
                    }
                });
            }
        });
    }

Session.prototype.parseHeadersAndCreateByteBuffer = function(first_msg) {
    var msg = ByteBuffer.concat([first_msg]);
    var original_length = msg.limit;

    var sharp1 = msg.readByte();
    var sharp2 = msg.readByte();
    if (sharp1 != 0x23 || sharp2 != 0x23) {
        console.error("Didn't receive expected header signature.");
        return null;
    }
    var messageType = msg.readUint16();
    var messageLength = msg.readUint32();
    var messageBuffer = new ByteBuffer(messageLength);
    if (messageLength > 0) {
        messageBuffer.append(msg);
    }

    return [messageType, messageLength, messageBuffer];
}

Session.prototype.receiveMessage = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
        self.receive().then(function(report) {
            var headers = self.parseHeadersAndCreateByteBuffer(report.data);
            if (headers == null) {
                reject("Failed to parse headers.");
            } else {
                self.receiveMoreOfMessageBody(headers[2], headers[1])
                .then(function(byteBuffer) {
                    byteBuffer.reset();
                    var tp_name = self._types[headers[0]];
                    resolve({type: tp_name,
                             message: _root[tp_name].decode(byteBuffer.toArrayBuffer())});
                });
            }
        });
    });
}

Session.prototype.getEntropy = function (size) {
    return this._typedCommonCall('GetEntropy', 'Entropy', {
        size: size
    });
};

Session.prototype.getAddress = function (address_n) {
    return this._typedCommonCall('GetAddress', 'Address', {
        address_n: address_n
    }).then(function (res) {
        res.message.path = address_n || [];
        return res;
    });
};

Session.prototype.getPublicKey = function (address_n) {
    return this._typedCommonCall('GetPublicKey', 'PublicKey', {
        address_n: address_n
    }).then(function (res) {
        res.message.node.path = address_n || [];
        return res;
    });
};

Session.prototype.wipeDevice = function () {
    return this._commonCall('WipeDevice');
};

Session.prototype.resetDevice = function (settings) {
    return this._commonCall('ResetDevice', settings);
};

Session.prototype.loadDevice = function (settings) {
    return this._commonCall('LoadDevice', settings);
};

Session.prototype.recoverDevice = function (settings) {
    return this._commonCall('RecoveryDevice', settings);
};

Session.prototype.applySettings = function (settings) {
    return this._commonCall('ApplySettings', settings);
};

Session.prototype.changePin = function (remove) {
    return this._commonCall('ChangePin', {
        remove: remove || false
    });
};

Session.prototype.eraseFirmware = function () {
    return this._commonCall('FirmwareErase');
};

Session.prototype.uploadFirmware = function (payload) {
    return this._commonCall('FirmwareUpload', {
        payload: payload
    });
};

Session.prototype.verifyMessage = function (address, signature, message) {
    return this._commonCall('VerifyMessage', {
        address: address,
        signature: signature,
        message: message
    });
};

Session.prototype.signMessage = function (address_n, message, coin) {
    return this._typedCommonCall('SignMessage', 'MessageSignature', {
        address_n: address_n,
        message: message,
        coin_name: coin.coin_name
    });
};

Session.prototype.measureTx = function (inputs, outputs, coin) {
    return this._typedCommonCall('EstimateTxSize', 'TxSize', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coin.coin_name
    });
};

Session.prototype.simpleSignTx = function (inputs, outputs, txs, coin) {
    return this._typedCommonCall('SimpleSignTx', 'TxRequest', {
        inputs: inputs,
        outputs: outputs,
        coin_name: coin.coin_name,
        transactions: txs
    });
};

Session.prototype._indexTxsForSign = function (inputs, outputs, txs) {
    var index = {};

    // Tx being signed
    index[''] = {
        inputs: inputs,
        outputs: outputs
    };

    // Referenced txs
    txs.forEach(function (tx) {
        index[tx.hash.toUpperCase()] = tx;
    });

    return index;
};

Session.prototype.signTx = function (inputs, outputs, txs, coin) {
    var self = this,
        index = this._indexTxsForSign(inputs, outputs, txs),
        signatures = [],
        serializedTx = '';

    return this._typedCommonCall('SignTx', 'TxRequest', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coin.coin_name
    }).then(process);

    function process(res) {
        var m = res.message,
            ms = m.serialized,
            md = m.details,
            reqTx, resTx;

        if (ms && ms.serialized_tx != null)
            serializedTx += ms.serialized_tx.toHex();
        if (ms && ms.signature_index != null)
            signatures[ms.signature_index] = ms.signature;

        if (m.request_type === _root.RequestType.TXFINISHED)
            return { // same format as SimpleSignTx
                message: {
                    serialized: {
                        signatures: signatures,
                        serialized_tx: serializedTx
                    }
                }
            };

        resTx = {};
        reqTx = index[md.tx_hash ? md.tx_hash.toHex().toUpperCase() : ''];

        if (!reqTx)
            throw new Error(md.tx_hash
                ? ('Requested unknown tx: ' + md.tx_hash)
                : ('Requested tx for signing not indexed')
            );

        switch (m.request_type) {

        case _root.RequestType.TXINPUT:
            resTx.inputs = [reqTx.inputs[+md.request_index]];
            break;

        case _root.RequestType.TXOUTPUT:
            if (md.tx_hash)
                resTx.bin_outputs = [reqTx.bin_outputs[+md.request_index]];
            else
                resTx.outputs = [reqTx.outputs[+md.request_index]];
            break;

        case _root.RequestType.TXMETA:
            resTx.version = reqTx.version;
            resTx.lock_time = reqTx.lock_time;
            resTx.inputs_cnt = reqTx.inputs.length;
            if (md.tx_hash)
                resTx.outputs_cnt = reqTx.bin_outputs.length;
            else
                resTx.outputs_cnt = reqTx.outputs.length;
            break;

        default:
            throw new Error('Unknown request type: ' + m.request_type);
        }

        return self._typedCommonCall('TxAck', 'TxRequest', {
            tx: resTx
        }).then(process);
    }
};

Session.prototype._typedCommonCall = function (type, resType, msg) {
    var self = this;

    if (type == "SignMessage") {
        msg.message = ByteBuffer.fromHex(msg.message);
    }
    return this._commonCall(type, msg).then(function (res) {
        return self._assertType(res, resType);
    });
};

Session.prototype._assertType = function (res, resType) {
    if (res.type !== resType)
        throw new TypeError('Response of unexpected type: ' + res.type);
    return res;
};

Session.prototype._commonCall = function (type, msg) {
    var self = this,
        callpr = this._call(type, msg);

    return callpr.then(function (res) {
        return self._filterCommonTypes(res);
    });
};

Session.prototype._filterCommonTypes = function (res) {
    var self = this;

    if (res.type === 'Failure')
        throw res.message;

    if (res.type === 'ButtonRequest') {
        this.emit('button', res.message.code);
        return this._commonCall('ButtonAck');
    }

    if (res.type === 'EntropyRequest')
        return this._commonCall('EntropyAck', {
            entropy: stringToHex(this._generateEntropy(32))
        });

    if (res.type === 'PinMatrixRequest')
        return this._promptPin(res.message.type).then(
            function (pin) {
                return self._commonCall('PinMatrixAck', { pin: pin });
            },
            function () {
                return self._commonCall('Cancel');
            }
        );

    if (res.type === 'PassphraseRequest')
        return this._promptPassphrase().then(
            function (passphrase) {
                return self._commonCall('PassphraseAck', { passphrase: passphrase });
            },
            function () {
                return self._commonCall('Cancel');
            }
        );

    if (res.type === 'WordRequest')
        return this._promptWord().then(
            function (word) {
                return self._commonCall('WordAck', { word: word });
            },
            function () {
                return self._commonCall('Cancel');
            }
        );

    return res;
};

Session.prototype._promptPin = function (type) {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self.emit('pin', type, function (err, pin) {
            if (err || pin == null)
                reject(err);
            else
                resolve(pin);
        })) {
            console.warn('[trezor] PIN callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._promptPassphrase = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self.emit('passphrase', function (err, passphrase) {
            if (err || passphrase == null)
                reject(err);
            else
                resolve(passphrase.normalize('NFKD'));
        })) {
            console.warn('[trezor] Passphrase callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._promptWord = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        if (!self.emit('word', function (err, word) {
            if (err || word == null)
                reject(err);
            else
                resolve(word.toLocaleLowerCase());
        })) {
            console.warn('[trezor] Word callback not configured, cancelling request');
            reject();
        }
    });
};

Session.prototype._generateEntropy = function (len) {
    if (window.crypto && window.crypto.getRandomValues)
        return this._generateCryptoEntropy(len);
    else
        return this._generatePseudoEntropy(len);
};

Session.prototype._generateCryptoEntropy = function (len) {
    var arr = new Uint8Array(len);

    window.crypto.getRandomValues(arr);

    return String.fromCharCode.apply(String, arr);
};

Session.prototype._generatePseudoEntropy = function (len) {
    var arr = [],
        i;

    for (i = 0; i < len; i++)
        arr[i] = Math.floor(Math.random() * 255);

    return String.fromCharCode.apply(String, arr);
};

Session.prototype._call = function (type, msg) {
    var self = this,
        timeout = this._timeoutForType(type);

    msg = msg || {};

    return new Promise(function (resolve, reject) {
        console.log('[trezor] Sending:', type, JSON.stringify(msg));
        self.emit('send', type, msg);

        var msg_pb = new _root[type]();
        for (var k in msg) {
            msg_pb[k] = msg[k];
        }
        self.send(
            63,
            self.serializeMessageForTransport(
                msg_pb,
                _root.MessageType['MessageType_'+type]
            )
        ).then(function() {
            return self.receiveMessage();
        }).then(function(result) {
            console.log('[trezor] Received:', result);
            self.emit('receive');
            resolve(result);
        })
    });
};

Session.prototype._timeoutForType = function (type) {
    // No calls use timeout now
    return false;
};

//
// Hex codec
//

// Encode binary string to hex string
function stringToHex(bin) {
    var i, chr, hex = '';

    for (i = 0; i < bin.length; i++) {
        chr = (bin.charCodeAt(i) & 0xFF).toString(16);
        hex += chr.length < 2 ? '0' + chr : chr;
    }

    return hex;
}

// Decode hex string to binary string
function hexToString(hex) {
    var i, bytes = [];

    for (i = 0; i < hex.length - 1; i += 2)
        bytes.push(parseInt(hex.substr(i, 2), 16));

    return String.fromCharCode.apply(String, bytes);
}
