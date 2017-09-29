var SchnorrSigningKey = require('wallet').bitcoinup.SchnorrSigningKey;
var wally = require('wallyjs');

angular.module('greenWalletReceiveControllers',
    ['greenWalletServices'])
.controller('ReceiveController', ['$rootScope', '$scope', 'wallets', '$filter', 'tx_sender', 'notices', 'cordovaReady', 'storage', 'storage_keys', 'hostname', 'gaEvent', '$uibModal', '$location', 'qrcode', 'clipboard', 'branches', '$q',
        function InfoController($rootScope, $scope, wallets, $filter, tx_sender, notices, cordovaReady, storage, storage_keys, hostname, gaEvent, $uibModal, $location, qrcode, clipboard, branches, $q) {
    if(!wallets.requireWallet($scope)) return;
    $scope.wallet.signup = false;  // required for 2FA settings to work properly in the same session as signup

    var payment_url_prefix = 'https://' + hostname + '/pay/';
    var base_payment_url = payment_url_prefix + $scope.wallet.receiving_id + '/';
    $scope.receive = {
        payment_url: base_payment_url,
        show_previous_addresses: function() {
            $rootScope.is_loading += 1;
            tx_sender.call('com.greenaddress.addressbook.get_my_addresses', $scope.wallet.current_subaccount).then(function(data) {
                $scope.receive.my_addresses = data;
                $scope.receive.my_addresses.has_more = $scope.receive.my_addresses[$scope.receive.my_addresses.length - 1].pointer > 1;
                $uibModal.open({
                    templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_my_addresses.html',
                    scope: $scope
                });
            }, function(err) {
                notices.makeNotice('error', err.args[1]);
            }).finally(function() { $rootScope.decrementLoading(); });
        },
        show_more_addresses: function() {
          $rootScope.is_loading += 1;
            var first_pointer = $scope.receive.my_addresses[$scope.receive.my_addresses.length - 1].pointer;
            tx_sender.call('com.greenaddress.addressbook.get_my_addresses',
                    $scope.wallet.current_subaccount, first_pointer).then(function(data) {
                $scope.receive.my_addresses = $scope.receive.my_addresses.concat(data);
                var first_pointer = $scope.receive.my_addresses[$scope.receive.my_addresses.length - 1];
                $scope.receive.my_addresses.has_more = $scope.receive.my_addresses[$scope.receive.my_addresses.length - 1].pointer > 1;
            }, function(err) {
                notices.makeNotice('error', err.args[1]);
            }).finally(function() { $rootScope.decrementLoading(); });
        },
        is_bip38: function(privkey) {
            return new Bitcoin.bip38().verify(privkey);
        },
        sweep: function() {
            var do_sweep_key = function(key) {
                var pubkey = key.getPublicKeyBuffer();
                that.sweeping = true;
                tx_sender.call(
                    "com.greenaddress.vault.prepare_sweep_social",
                    Array.from(pubkey),
                    true,
                    $scope.wallet.current_subaccount
                ).then(function(data) {
                    data.prev_outputs = [];
                    for (var i = 0; i < data.prevout_scripts.length; i++) {
                        data.prev_outputs.push({
                            // {keyPair: key} is a fake hdnode, which should be
                            // enough for signing purposes
                            privkey: new SchnorrSigningKey({keyPair: key}),
                            script: new Bitcoin.Buffer.Buffer(
                                data.prevout_scripts[i], 'hex'
                            )
                        })
                    }
                    var satoshi_value = 0;
                    // TODO: verify
                    new Bitcoin.contrib.transactionFromHex(data.tx).outs.forEach(function (item, i) {
                        satoshi_value += item.value;
                    });
                    var sweep_tx_data = $rootScope.$new();
                    sweep_tx_data.message = gettext("Your account will be funded with %s.".replace("%s", $filter('format_btc')(satoshi_value, $scope.wallet.unit)));
                    var modal = $uibModal.open({
                        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_receive_sweep.html',
                        scope: sweep_tx_data
                    });
                    modal.result.then(function () {
                        wallets.sign_and_send_tx($scope, data, false, null, gettext('Funds swept')).then(function() {
                            $location.url('/info/');
                        });
                        sweep_tx_data.$destroy();
                    }, function () {
                        sweep_tx_data.$destroy();
                    });
                }).catch(function(error) {
                    that.sweeping = false;
                    if (error.args && error.args[0] == 'http://greenaddressit.com/error#notenoughmoney') {
                        notices.makeNotice('error', gettext('Already swept or no funds found'));
                    } else {
                        notices.makeError($scope, error);
                    }
                }).finally(function() {
                    that.sweeping = false;
                });;
            }

            var that = this;
            var key_wif = this.privkey_wif;
            var iframe;
            if (new Bitcoin.bip38().verify(key_wif)) {
                that.sweeping = true;
                var errors = {
                    invalid_privkey: gettext('Not a valid encrypted private key'),
                    invalid_passphrase: gettext('Invalid passphrase')
                };
                wally.wally_base58_to_bytes(key_wif).then(function (bytes) {
                    wally.bip38_to_private_key(
                        key_wif, new Buffer(that.bip38_password, 'utf-8'), 0
                    ).then(function (data) {
                        $scope.$apply(function() {
                            do_sweep_key(new Bitcoin.bitcoin.ECPair(
                                Bitcoin.BigInteger.fromBuffer(data), null, {
                                    compressed: !!(bytes[2] & 0x20)
                                })
                            );
                        });
                    });
                });
            } else if (key_wif.indexOf('K') == 0 || key_wif.indexOf('L') == 0 || key_wif.indexOf('5') == 0 // prodnet
                    || key_wif.indexOf('c') == 0 || key_wif.indexOf('9') == 0) { // testnet
                var key_bytes = Bitcoin.bs58.decode(key_wif);
                if (key_bytes.length != 38 && key_bytes.length != 37) {
                    notices.makeNotice(gettext('Not a valid private key'));
                    return;
                }
                var expChecksum = key_bytes.slice(-4);
                key_bytes = key_bytes.slice(0, -4);
                var checksum = Bitcoin.bitcoin.crypto.hash256(key_bytes);
                if (checksum[0] != expChecksum[0] || checksum[1] != expChecksum[1] || checksum[2] != expChecksum[2] || checksum[3] != expChecksum[3]) {
                    notices.makeNotice(gettext('Not a valid private key'));
                    return;
                }
                if (key_bytes.length == 34) {
                    key_bytes = key_bytes.slice(1, -1);
                    var compressed = true;
                } else {
                    key_bytes = key_bytes.slice(1);
                    var compressed = false;
                }
                do_sweep_key(
                    new Bitcoin.bitcoin.ECPair(
                        Bitcoin.BigInteger.fromByteArrayUnsigned(key_bytes),
                        null,
                        {network: cur_net, compressed: compressed})
                );
            } else {
                notices.makeNotice(gettext('Not a valid private key'));
                return;
            }
        },
        read_wif_qr_code: function($event) {
            gaEvent('Wallet', 'ReceiveReadWIFQrCode');
            var that = this;
            qrcode.scan($scope, $event, '_receive').then(function(text) {
                gaEvent('Wallet', 'ReceiveReadWIFQrCodeSuccessful');
                $rootScope.safeApply(function() {
                    that.privkey_wif = text;
                });
            }, function(error) {
                gaEvent('Wallet', 'ReceiveReadWIFQrCodeFailed', error);
                notices.makeNotice('error', error);
            });
        },
        stop_scanning_qr_code: function() {
            qrcode.stop_scanning($scope);
        },
        show_sweep: true   // used to be false for testnet, now we support
                           // testnet sweeping too
    };
    var div = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits': 1000000}[$scope.wallet.unit];
    var formatAmountBitcoin = function(amount) {
        var satoshi = Bitcoin.Util.parseValue(amount.toString()).divide(Bitcoin.BigInteger.valueOf(div));
        return Bitcoin.Util.formatValue(satoshi.toString());
    };
    var formatAmountSatoshi = function(amount) {
        var satoshi = Bitcoin.Util.parseValue(amount.toString()).divide(Bitcoin.BigInteger.valueOf(div));
        return satoshi.toString();
    }
    $scope.show_bitcoin_uri = function(show_qr) {
        if ($scope.receive.bitcoin_uri) {
            if (show_qr) $scope.show_url_qr($scope.receive.bitcoin_uri);
        } else {
            gaEvent('Wallet', 'ReceiveShowBitcoinUri');
            var confidential = cur_net.isAlpha;
            var args = [
                'com.greenaddress.vault.fund',
                $scope.wallet.current_subaccount,
                true /* return_pointer */,
                $scope.wallet.appearance.use_segwit ? 'p2wsh' : 'p2sh'
            ];
            if (confidential) {
                // old server doesn't support the 4th argument
                args.push(true);
            }
            tx_sender.call.apply(tx_sender, args).then(function(data) {
                var expectedScript;
                if (!tx_sender.gaWallet.scriptFactory) {
                    expectedScript = Promise.resolve(null);
                } else {
                  var gaSubaccount = tx_sender.gaWallet.getSubaccountByPointer(
                      $scope.wallet.current_subaccount
                  );
                  var scriptFactory = tx_sender.gaWallet.scriptFactory;
                  expectedScript = scriptFactory.createScriptForSubaccountAndPointer(
                      gaSubaccount, data.pointer
                  );
                }
                return Promise.all([expectedScript, Promise.resolve(data)]);
            }).then(function(expectedAndData) {
              var expectedScript = expectedAndData[0];
              var data = expectedAndData[1];
              if (!expectedScript) {
                  if (!tx_sender.gaWallet.watchOnlyHDWallet) {
                      throw new Error("Missing script in non watch-only mode.")
                  }
              } else if (expectedScript.toString('hex') !== data.script) {
                 throw new Error("Invalid script returned");
              }
              return confidential ? data : data.script;
            }).then(function(data) {
                var address;
                if (confidential) {
                    var key = $q.when($scope.wallet.hdwallet);
                    if ($scope.wallet.current_subaccount) {
                        key = key.then(function(key) {
                            return key.deriveHardened(branches.SUBACCOUNT)
                        }).then(function(key) {
                            return key.deriveHardened($scope.wallet.current_subaccount);
                        });
                    }
                    address = key.then(function(key) {
                        return key.deriveHardened(branches.BLINDED)
                    }).then(function(branch) {
                        return branch.deriveHardened(data.pointer);
                    }).then(function(blinded_key) {
                        var version;
                        if (cur_net === Bitcoin.bitcoin.networks.bitcoin) {
                            version = 10;
                        } else {
                            version = 25;
                        }
                        return tx_sender.call(
                            'com.greenaddress.vault.set_scanning_key',
                            $scope.wallet.current_subaccount,
                            data.pointer,
                            Array.from(blinded_key.keyPair.getPublicKeyBuffer())
                        ).then(function() {
                            return Bitcoin.bs58check.encode(Bitcoin.Buffer.Buffer.concat([
                                new Bitcoin.Buffer.Buffer([version, cur_net.scriptHash]),
                                blinded_key.keyPair.getPublicKeyBuffer(),
                                Bitcoin.bitcoin.crypto.hash160(
                                    new Bitcoin.Buffer.Buffer(data.script, 'hex')
                                )
                            ]));
                        });
                    });
                } else {
                    var script = new Bitcoin.Buffer.Buffer(data, 'hex');
                    if ($scope.wallet.appearance.use_segwit) {
                        storage.set($scope.wallet.segwit_locked_key, true);
                        var hash = Bitcoin.bitcoin.crypto.sha256(script);
                        var buf = Bitcoin.Buffer.Buffer.concat([
                            new Bitcoin.Buffer.Buffer([0, 32]),
                            hash
                        ]);
                        address = $q.when(
                            Bitcoin.bitcoin.address.toBase58Check(
                                Bitcoin.bitcoin.crypto.hash160(buf),
                                cur_net.scriptHash
                            )
                        );
                    } else {
                        var hash = Bitcoin.bitcoin.crypto.hash160(script);
                        var version = cur_net.scriptHash;
                        address = $q.when(
                            Bitcoin.bitcoin.address.toBase58Check(hash, cur_net.scriptHash)
                        );
                    }
                }
                address.then(function(address) {
                    $scope.receive.bitcoin_address = address;
                    $scope.receive.base_bitcoin_uri = $scope.receive.bitcoin_uri = 'bitcoin:' + address;
                    if ($scope.receive.amount) {
                        $scope.receive.bitcoin_uri += '?amount=' + formatAmountBitcoin($scope.receive.amount);
                    }
                    if (show_qr) $scope.show_url_qr($scope.receive.bitcoin_uri);
                });
            }).catch(function (err) {
                notices.makeNotice('error', err ? (err.message || err) : 'Unknown error occurred');
                console.log(err);
            });
        }
    }
    $scope.show_confidential_uri = function() {
        return $scope.show_bitcoin_uri(false, true);
    }
    $scope.show_myaddr_qrcode = function(addr) {
        $scope.show_url_qr('bitcoin:' + addr);
    }
    $scope.$watch('wallet.current_subaccount', function(newValue, oldValue) {
        if (newValue != oldValue) {
            $scope.receive.bitcoin_uri = undefined;
            $scope.receive.bitcoin_address = undefined;
        }
        var receiving_id;
        if (newValue) {
            for (var k in $scope.wallet.subaccounts)
                if ($scope.wallet.subaccounts[k].pointer == newValue)
                    receiving_id = $scope.wallet.subaccounts[k].receiving_id;
        } else receiving_id = $scope.wallet.receiving_id;
        base_payment_url = payment_url_prefix + receiving_id + '/';
        $scope.receive.payment_url = base_payment_url;
        if ($scope.receive.amount) {
            $scope.receive.payment_url = base_payment_url + '?amount=' + formatAmountSatoshi($scope.receive.amount);
        }
    })
    $scope.copy_from_clipboard = function(send_tx) {
        clipboard.paste(function(data) {
            console.log(data);
            send_tx.recipient = data;
        });
    };
    $scope.copy_to_clipboard = function(data) {
        clipboard.copy(data).then(
            function(text){
                notices.makeNotice('success', text);
            },
            function(error){
                notices.makeNotice('error', error);
            }
        );
    };
    wallets.addCurrencyConversion($scope, 'receive');
    $scope.$watch('receive.amount', function(newValue, oldValue) {
        if (newValue === oldValue) return;
        if (newValue) {
            $scope.receive.payment_url = base_payment_url + '?amount=' + formatAmountSatoshi(newValue);
            if ($scope.receive.bitcoin_uri) {
                $scope.receive.bitcoin_uri = $scope.receive.base_bitcoin_uri + '?amount=' + formatAmountBitcoin(newValue);
            }
        } else {
            $scope.receive.payment_url = base_payment_url;
            $scope.receive.bitcoin_uri = $scope.receive.base_bitcoin_uri;
        }
    });
}]);
