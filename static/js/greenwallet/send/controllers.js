var AssetsTransaction = require('wallet').bitcoinup.AssetsTransaction;
var bufferEquals = require('buffer-equals');
angular.module('greenWalletSendControllers',
    ['greenWalletServices'])
.controller('SendController', ['$scope', 'wallets', 'tx_sender', 'cordovaReady', 'notices', 'branches', 'wallets', '$routeParams', 'hostname', 'gaEvent', '$uibModal', '$location', '$rootScope', '$q', 'parse_bitcoin_uri', 'qrcode', 'sound', 'encode_key',
         function SendController($scope, wallets, tx_sender, cordovaReady, notices, branches, wallets, $routeParams, hostname, gaEvent, $uibModal, $location, $rootScope, $q, parse_bitcoin_uri, qrcode, sound, encode_key) {
    if (!wallets.requireWallet($scope)) return;

    var _verify_tx = function(that, rawtx, destination, satoshis, change_pointer, no_electrum) {
        if (cur_net.isAlphaMultiasset) {
            // FIXME: get rid of this function altogether: when we construct
            //        all transactions client-side, there is no need for
            //        verification anymore
            //        (originally disabled for multiasset because we don't
            //         have multiasset transaction parsing implemented
            //         client-side)
            return $q.resolve(true);
        }

        var d = $q.defer();
        var tx = Bitcoin.contrib.transactionFromHex(rawtx);

        if (destination && (0 != destination.indexOf('GA'))) {  // we can't verify GA* addresses
            // decode the expected destination address
            var bytes = new Bitcoin.Buffer.Buffer(Bitcoin.bs58.decode(destination));
            var hash = bytes.slice(0, 21);

            var checksum = Bitcoin.bitcoin.crypto.hash256(hash);

            if (checksum[0] != bytes[21] ||
                checksum[1] != bytes[22] ||
                checksum[2] != bytes[23] ||
                checksum[3] != bytes[24]) {
                    return $q.reject(gettext("Checksum validation failed!"));
            }

            var version = hash[0];
            hash = hash.slice(1);
            var cur_version = cur_net.pubKeyHash;
            var cur_p2sh_version = cur_net.scriptHash;
            if (version != cur_version && version != cur_p2sh_version) {
                return $q.reject(gettext("Version "+version+" not supported!"));
            }
        }

        if (tx.outs.length < 1 ||
                tx.outs.length > (cur_net.isAlphaMultiasset ? 3 : 2)) {
            return $q.reject(tx.outs.length + gettext(' is not a valid number of outputs'));
        }

        // check change output if present
        var change_d, subaccount;
        for (var i = 0; i < $scope.wallet.subaccounts.length; i++) {
            if ($scope.wallet.subaccounts[i].pointer == $scope.wallet.current_subaccount) {
                subaccount = $scope.wallet.subaccounts[i];
                break;
            }
        }
        if (subaccount && subaccount.type == '2of3') {
            // FIXME implement paranoid checks for 2of3
            return $q.when({success: true});
        }
        if (tx.outs.length == 2) {
            if ($scope.wallet.current_subaccount) {
                var derive_hd = function() {
                    return $q.when($scope.wallet.hdwallet.deriveHardened(branches.SUBACCOUNT)).then(function(subaccounts_branch) {
                        return $q.when(subaccounts_branch.deriveHardened($scope.wallet.current_subaccount)).then(function(subaccount) {
                            return subaccount.derive(branches.REGULAR);
                        });
                    });
                }
                var derive_btchip = function() {
                    return $scope.wallet.btchip.app.getWalletPublicKey_async("3'/"+$scope.wallet.current_subaccount+"'").then(function(result) {
                        var pubHex = result.publicKey.toString(HEX)
                        var chainCode = result.chainCode.toString(HEX)
                        var pubKey = Bitcoin.bitcoin.ECPair.fromPublicKeyBuffer(
                            new Bitcoin.Buffer.Buffer(pubHex, 'hex'),
                            cur_net
                        );
                        pubKey.compressed = true;
                        var subaccount = new Bitcoin.bitcoin.HDNode(
                            pubKey,
                            new Bitcoin.Buffer.Buffer(chainCode, 'hex')
                        );
                        return subaccount.derive(branches.REGULAR);
                    });
                }
                var derive_trezor = function() {
                    return $scope.wallet.trezor_dev.getPublicKey([3 + 0x80000000, $scope.wallet.current_subaccount + 0x80000000]).then(function(result) {
                        return Bitcoin.bitcoin.HDNode.fromBase58(result.message.xpub).derive(branches.REGULAR);
                    })
                }
                if ($scope.wallet.hdwallet.keyPair.d) derive_fun = derive_hd;
                else if ($scope.wallet.trezor_dev) derive_fun = derive_trezor;
                else derive_fun = derive_btchip;
                var change_branch = derive_fun();
            } else {
                var change_branch = $q.when($scope.wallet.hdwallet.derive(branches.REGULAR));
            }
            var change_key = change_branch.then(function(change_branch) {
                return change_branch.derive(change_pointer);
            });
            var change_key_bytes = change_key.then(function(change_key) {
                return change_key.getPublicKeyBuffer();
            });
            var gawallet = new Bitcoin.bitcoin.HDNode(
                Bitcoin.bitcoin.ECPair.fromPublicKeyBuffer(
                    new Bitcoin.Buffer.Buffer(deposit_pubkey, 'hex'),
                    cur_net
                ),
                new Bitcoin.Buffer.Buffer(deposit_chaincode, 'hex')
            );
            if ($scope.wallet.current_subaccount) {
                change_d = change_key_bytes.then(function(change_key_bytes) {
                    return $q.when(gawallet.derive(branches.SUBACCOUNT)).then(function(gawallet) {
                        return $q.when(gawallet.subpath($scope.wallet.gait_path)).then(function(gawallet) {
                            return $q.when(gawallet.derive($scope.wallet.current_subaccount)).then(function(gawallet_subaccount) {
                                return $q.when(gawallet_subaccount.derive(change_pointer)).then(function(change_gait_key) {
                                    return [change_key_bytes, change_gait_key];
                                });
                            });
                        });
                    });
                });
            } else {
                change_d = change_key_bytes.then(function(change_key_bytes) {
                    return $q.when(gawallet.derive(1)).then(function(gawallet) {
                        return $q.when(gawallet.subpath($scope.wallet.gait_path)).then(function(gawallet) {
                            return $q.when(gawallet.derive(change_pointer)).then(function(change_gait_key) {
                                return [change_key_bytes, change_gait_key];
                            });
                        });
                    });
                });
            }
            change_d = change_d.then(function(change_keys) {
                var change_key_bytes = change_keys[0], change_gait_key = change_keys[1];
                var script_to_hash = Bitcoin.bitcoin.script.compile([
                    Bitcoin.bitcoin.opcodes.OP_2,
                    change_gait_key.getPublicKeyBuffer(),
                    change_key_bytes,
                    Bitcoin.bitcoin.opcodes.OP_2,
                    Bitcoin.bitcoin.opcodes.OP_CHECKMULTISIG
                ]);

                var hash160 = Bitcoin.bitcoin.crypto.hash160(script_to_hash).toString('hex'),
                    hash160_segwit = null;
                if (cur_net.isSegwit) {
                    var hash256 = Bitcoin.bitcoin.crypto.sha256(script_to_hash);
                    var buf = Bitcoin.Buffer.Buffer.concat([
                        new Bitcoin.Buffer.Buffer([0, 32]),
                        hash256
                    ]);
                    hash160_segwit = Bitcoin.bitcoin.crypto.hash160(buf).toString('hex');
                }
                for (var i = 0; i < tx.outs.length; i++) {
                    var chunks = Bitcoin.bitcoin.script.decompile(tx.outs[i].script);
                    if (chunks.length != 3 || (
                            hash160 != chunks[1].toString('hex') &&
                            !(hash160_segwit &&
                                hash160_segwit == chunks[1].toString('hex')))) {
                        if (i == tx.outs.length - 1) {
                            return $q.reject(gettext('Missing change P2SH script'));
                        }
                    } else {
                        if (chunks[0] != Bitcoin.bitcoin.opcodes.OP_HASH160) return $q.reject(gettext('change OP_HASH160 missing'));
                        if (chunks[2] != Bitcoin.bitcoin.opcodes.OP_EQUAL) return $q.reject(gettext('change OP_EQUAL missing'));
                        var change_i = i;
                        break;
                    }
                }

                return 1 - change_i;
            });
        } else {
            change_d = $q.when(0);
        }

        if (destination && (0 != destination.indexOf('GA'))) {  // we can't verify GA* addresses
            change_d = change_d.then(function(out_i) {
                // verify the output - make sure the given hash exists among outputs
                var chunks = Bitcoin.bitcoin.script.decompile(tx.outs[out_i].script);
                if (version == cur_version) {
                    if (chunks.length != 5) return $q.reject(gettext('Invalid pubkey hash script length'));
                    if (chunks[0] != Bitcoin.bitcoin.opcodes.OP_DUP) return $q.reject(gettext('OP_DUP missing'));
                    if (chunks[1] != Bitcoin.bitcoin.opcodes.OP_HASH160) return $q.reject(gettext('OP_HASH160 missing'));
                    if (chunks[2].toString('hex') != hash.toString('hex')) return $q.reject(gettext('Invalid pubkey hash'));
                    if (chunks[3] != Bitcoin.bitcoin.opcodes.OP_EQUALVERIFY) return $q.reject(gettext('OP_EQUALVERIFY missing'));
                    if (chunks[4] != Bitcoin.bitcoin.opcodes.OP_CHECKSIG) return $q.reject(gettext('OP_CHECKSIG missing'));
                } else if (version == cur_p2sh_version) {
                    if (chunks.length != 3) return $q.reject(gettext('Invalid out P2SH script length'));
                    if (chunks[0] != Bitcoin.bitcoin.opcodes.OP_HASH160) return $q.reject(gettext('out OP_HASH160 missing'));
                    if (chunks[1].toString('hex') != hash.toString('hex')) return $q.reject(gettext('Invalid out P2SH hash'));
                    if (chunks[2] != Bitcoin.bitcoin.opcodes.OP_EQUAL) return $q.reject(gettext('out OP_EQUAL missing'));
                }

                if (that.add_fee.party == 'sender' && !that.spend_all) {
                    // check output value
                    if (new Bitcoin.BigInteger(tx.outs[out_i].value.toString()).compareTo(
                            new Bitcoin.BigInteger(satoshis)) != 0) {
                        return $q.reject(gettext('Invalid output value'));
                    }
                }

                return out_i;
            });
        }

        // no Electrum, no cache - can't verify inputs
        if (no_electrum) return change_d.then(function() {
            return {success: true}
        });

        // calculate the inputs value
        var in_value_promises = [];
        var in_value = Bitcoin.BigInteger.valueOf(0);
        var verified_n = 0;
        for (var i = 0; i < tx.ins.length; i++) {
            var outpoint = tx.ins[i];
            in_value_promises.push(
                $scope.wallet.get_tx_output_value(outpoint.hash, outpoint.index, no_electrum).then(function(r) {
                    verified_n += 1;
                    $scope.send_tx.verifying_percentage = Math.round(100 * verified_n / tx.ins.length);
                    return r;
                })
            );
        }
        return $q.all(in_value_promises).then(function(values) {
            for (var i = 0; i < values.length; ++i) {
                if (!values[i]) return $q.reject(gettext('Missing input'));
                in_value = in_value.add(values[i]);  // already BigInteger
            }
            if (in_value.compareTo(Bitcoin.BigInteger.valueOf(0)) <= 0)
                // just in case we have some bug in summing, like missing valueOf
                return $q.reject(gettext('Inputs value is not larger than zero'));

            // calculate the outputs value
            var out_value = new Bitcoin.BigInteger(tx.outs[0].value.toString());
            if (tx.outs[1]) {
                out_value = out_value.add(new Bitcoin.BigInteger(tx.outs[1].value.toString()));
            }

            // calculate fees
            var fee = in_value.subtract(out_value), recipient_fee = Bitcoin.BigInteger.valueOf(0);
            // subtract mod 10000 to allow anti-dust (<5430) fee
            if (that.add_fee.party == 'recipient' || that.spend_all) recipient_fee = fee.subtract(fee.mod(Bitcoin.BigInteger.valueOf(10000)));

            return change_d.then(function(out_i) {
                // check output value
                if (that.spend_all) satoshis = $scope.wallet.final_balance;
                if (new Bitcoin.BigInteger(tx.outs[out_i].value.toString()).compareTo(
                        new Bitcoin.BigInteger(satoshis).subtract(recipient_fee)) != 0) {
                    return $q.reject(gettext('Invalid output value'));
                }

                // check fee
                var kB = 2 * rawtx.length / 1000;
                var expectedMaxFee = Math.floor(500000 * kB);
                if (fee.compareTo(Bitcoin.BigInteger.valueOf(expectedMaxFee)) > 0) {
                    return $q.reject(gettext('Fee is too large (%1, expected at most %2)').replace('%1', fee.toString()).replace('%2', expectedMaxFee.toString()));
                }
                var expectedMinFee = Bitcoin.BigInteger.valueOf(1000);
                if (fee.compareTo(expectedMinFee) < 0) {
                    return $q.reject(gettext('Fee is too small (%1, expected at least %2)').replace('%1', fee.toString()).replace('%2', expectedMinFee.toString()));
                }

                return {success: true}
            });
        });
    };
    var verify_tx = function(that, rawtx, destination, satoshis, change_pointer) {
        var verify = function(no_electrum) {
            return _verify_tx(that, rawtx, destination, satoshis, change_pointer, no_electrum);
        };
        if (tx_sender.electrum) {
            var d = $q.defer();
            d.resolve(verify(true));
            // electrum is now disabled due to many issues with stability:
/*            tx_sender.electrum.checkConnectionsAvailable().then(function() {
                $scope.send_tx.verifying = true;
                $scope.send_tx.verifying_percentage = 0;
                d.resolve(verify(true).then(function(r) {
                    $scope.send_tx.verifying = false;
                    return r;
                }, function(err) {
                    if (err == 'no electrum') {
                        if (cur_net == 'testnet') return verify(true);
                        // for mainnnet, ask user if they want to skip Electrum:
                        return $uibModal.open({
                            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_no_electrum.html',
                            windowClass: 'twofactor' // display on top of loading indicator
                        }).result.then(function()  {
                            return verify(true);
                        }, function() {
                            return $q.reject(gettext('No Electrum servers reachable'));
                        });
                    } else {
                        return $q.reject(err);
                    }
                }));
            }, function() {
                $uibModal.open({
                    templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_no_electrum.html',
                    windowClass: 'twofactor' // display on top of loading indicator
                }).result.then(function()  {
                    d.resolve(verify(true));
                }, function() {
                    d.reject(gettext('No Electrum servers reachable'));
                });
            }); */
            return d.promise;
        } else {
            return verify(true);
        }
    }
    var iframe;
    var mul = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits': 1000000}[$scope.wallet.unit];
    var btcToUnit = function(btc) {
        var amount_satoshi = Bitcoin.Util.parseValue(btc);
        return parseFloat(  // parseFloat required for iOS Cordova
            Bitcoin.Util.formatValue(amount_satoshi.multiply(Bitcoin.BigInteger.valueOf(mul))));
    }
    var satoshisToUnit = function(amount_satoshi) {
        return parseFloat(  // parseFloat required for iOS Cordova
            Bitcoin.Util.formatValue(new Bitcoin.BigInteger(amount_satoshi.toString()).multiply(Bitcoin.BigInteger.valueOf(mul))));
    }
    var parseContact = function(str) {
        var json = new Bitcoin.Buffer.Buffer(Bitcoin.bs58.decode(str)).toString('utf-8');
        return JSON.parse(json);
    };
    $scope.send_tx = {
        _signing_progress_cb: function(progress) {
            this.signing = true;
            this.signing_percentage = Math.max(this.signing_percentage, progress);
        },
        add_fee: {'party': 'sender',
                  'per_kb': true,
                  'amount': ''},
        instant: $routeParams.contact ? (parseContact($routeParams.contact).requires_instant || false) : false,
        recipient: $routeParams.contact ? parseContact($routeParams.contact) : null,
        read_qr_code: function($event)  {
            gaEvent('Wallet', 'SendReadQrCode');
            var that = this;
            qrcode.scan($scope, $event, '_send').then(function(text) {
                gaEvent('Wallet', 'SendReadQrCodeSuccessful');
                $rootScope.safeApply(function() {
                    that.recipient = text;
                });
            }, function(error) {
                gaEvent('Wallet', 'SendReadQrCodeFailed', error);
                notices.makeNotice('error', error);
            });
        },
        stop_scanning_qr_code: function() {
            qrcode.stop_scanning($scope);
        },
        do_send_email: function(that, enckey, satoshis) {
            return tx_sender.call("com.greenaddress.vault.send_email", that.recipient.address,
                    'https://' + hostname + '/redeem/?amount=' + satoshis + '#/redeem/' + enckey).then(
                function() {
                    $rootScope.decrementLoading();
                    notices.makeNotice('success', gettext('Email sent'));
                    $location.url('/info/');
                }, function(err) {
                    $rootScope.decrementLoading();
                    notices.makeNotice('error', gettext('Failed sending email') + ': ' + err.args[1]);
                }
            );
        },
        do_create_voucher: function(that, enckey, satoshis) {
            $scope.voucher = {
                encrypted: !!that.passphrase,
                enckey: enckey,
                satoshis: satoshis,
                url: 'https://' + hostname + '/redeem/?amount=' + satoshis + '#/redeem/' + enckey,
                text: that.voucher_text
            };
            $uibModal.open({
                templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_voucher.html',
                scope: $scope
            }).result.finally(function() { $location.url('/info/'); });
            $rootScope.decrementLoading();
        },
        _send_social_ga: function(satoshis) {
            var that = this, to_addr = {type: this.recipient.type, id: that.recipient.address};
            var priv_data = {
                rbf_optin: $scope.wallet.appearance.replace_by_fee && !that.instant,
                instant: that.instant,
                prevouts_mode: 'http'
            };
            if (that.recipient.address != that.recipient.name) {
                priv_data.social_destination = that.recipient.name;
            }
            priv_data.allow_random_change = true;
            priv_data.memo = this.memo;
            priv_data.subaccount = $scope.wallet.current_subaccount;
            if (that.spend_all) satoshis = $scope.wallet.final_balance;
            tx_sender.call("com.greenaddress.vault.prepare_tx", satoshis, to_addr, this.get_add_fee(),
                           priv_data).then(function(data) {
                that.signing = true;
                wallets.sign_and_send_tx($scope, data, undefined, undefined, undefined, that._signing_progress_cb.bind(that)).then(function() {
                    if ($scope.wallet.send_from) $scope.wallet.send_from = null;
                    $location.url('/info/');
                }).finally(function() { that.sending = false; });
            }, function(error) {
                that.sending = false;
                notices.makeNotice('error', error.args[1]);
            });
        },
        amount_to_satoshis: function(amount) {
            var div = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits': 1000000}[$scope.wallet.unit];
            return Bitcoin.Util.parseValue(amount).divide(Bitcoin.BigInteger.valueOf(div)).toString();
        },
        get_add_fee: function() {
            var add_fee = angular.extend({}, this.add_fee);
            add_fee.amount = add_fee.amount == '' ? null : parseInt(this.amount_to_satoshis(add_fee.amount));
            if (this.spend_all) {
                add_fee.party = 'receiver';
            }
            return add_fee;
        },
        _encrypt_key: function(key) {
            return encode_key(key, !$scope.wallet.send_unencrypted && this.passphrase);
        },
        _send_social: function(do_send) {
            var that = this;
            var satoshis = that.amount_to_satoshis(this.amount);
            if (this.recipient && this.recipient.has_wallet) {
                this._send_social_ga(satoshis);
                return;
            }
            if (satoshis < 15430) {
                notices.makeNotice('error', gettext('Transaction amount must be at least 0.1543mBTC to allow redemption fee'));
                that.sending = false;
                return;
            }
            $rootScope.is_loading += 1;
            var send = function(key, pointer) {
                var to_addr = key.getAddress().toString();
                var add_fee = that.get_add_fee();
                var social_destination;
                if (that.voucher) {
                    social_destination = {
                        type: 'voucher',
                        text: that.voucher_text
                    };
                } else {
                    social_destination = {
                        name: that.recipient.name,
                        type: that.recipient.type
                    };
                    if (that.recipient.address != that.recipient.name) {
                        social_destination.id = that.recipient.address;
                    }
                }
                var priv_data = {rbf_optin: $scope.wallet.appearance.replace_by_fee && !that.instant,
                                 pointer: pointer,
                                 pubkey: Array.from(key.keyPair.getPublicKeyBuffer()),
                                 social_destination: social_destination,
                                 external_private: true,
                                 instant: that.instant,
                                 prevouts_mode: 'http'};
                that._encrypt_key(key.keyPair).then(function(b58) {
                    if (that.voucher && that.passphrase) {
                        priv_data.encrypted_key_hash = Array.from(Bitcoin.bitcoin.crypto.hash160(b58));
                    }
                    priv_data.allow_random_change = true;
                    priv_data.memo = that.memo;
                    priv_data.subaccount = $scope.wallet.current_subaccount;
                    if (cur_net.isAlphaMultiasset) {
                        priv_data.ga_asset_id = $scope.wallet.current_asset;
                    }
                    if (that.spend_all) satoshis = $scope.wallet.final_balance;
                    tx_sender.call("com.greenaddress.vault.prepare_tx", satoshis, to_addr, add_fee, priv_data).then(function(data) {
                        var d_verify = verify_tx(that, data.tx, key.getAddress().toString(), satoshis, data.change_pointer).catch(function(error) {
                            that.sending = false;
                            sound.play(BASE_URL + "/static/sound/wentwrong.mp3", $scope);
                            notices.makeNotice('error', gettext('Transaction verification failed: ' + error + '. Please contact support.'))
                            return $q.reject(error);
                        });
                        that.signing = true;
                        wallets.sign_and_send_tx($scope, data, false, undefined, false, that._signing_progress_cb.bind(that), d_verify).then(function() {
                            return do_send(that, b58, satoshis, key, pointer);
                        }, function(error) {
                            $rootScope.decrementLoading();
                        }).finally(function() { that.sending = false; });
                    }, function(error) {
                        $rootScope.decrementLoading();
                        that.sending = false;
                        notices.makeError($scope, error);
                    });
                });
            };
            tx_sender.call("com.greenaddress.vault.get_next_private_derived_pointer",
                    $scope.wallet.current_subaccount).then(function(pointer) {
                var key = $q.when($scope.wallet.hdwallet);
                if ($scope.wallet.current_subaccount) {
                    key = key.then(function(key) {
                        return key.deriveHardened(branches.SUBACCOUNT);
                    }).then(function(key) {
                        return key.deriveHardened($scope.wallet.current_subaccount);
                    })
                }
                key.then(function(key) {
                    return key.deriveHardened(branches.EXTERNAL);
                }).then(function(key) {
                    return key.deriveHardened(pointer);
                }).then(function(key) {
                    send(key, pointer);
                });
            }, function(error) {
                $rootScope.decrementLoading();
                that.sending = false;
                notices.makeNotice('error', error.args[1]);
            });
        },
        send_address: function() {
            var that = this;
            var to_addr = this.recipient.constructor === String ? this.recipient : this.recipient.address;
            var parsed_uri = parse_bitcoin_uri(to_addr);
            if (parsed_uri.recipient) to_addr = parsed_uri.recipient;
            var decoded = Bitcoin.bs58check.decode(to_addr);
            var isConfidential = (decoded[0] == 25 || decoded[0] == 10);
            var satoshis =
                this.spend_all ? "ALL" : this.amount_to_satoshis(this.amount);
            $rootScope.is_loading += 1;
            if (cur_net.isAlphaMultiasset) {
                var constructor;
                var subaccount = $scope.wallet.current_subaccount || null;
                // We need to do waitForConnection here because the new "walletjs" transaction sending implementation
                // depends on the "old connection" being up -- in sevices/tx_sender.js the gawallet is cleared
                // on disconnection, and in general gawallet is set only when connection is set.
                // (This fixes a bug which causes transaction sending to be impossible after disconnection from server
                //  when the 'Review & Send Money' button is clicked while still disconnected, and reconnection happens
                //  too late.)
                tx_sender.waitForConnection().then(function() {
                    return tx_sender.gawallet.loggedIn;
                }).then(function() {
                    constructor = tx_sender.gawallet.txConstructors[$scope.wallet.current_asset][subaccount];
                    // constructors are only available when connected
                    var refresh = [constructor.refreshUtxo()];
                    var feeConstructor;
                    if ($scope.wallet.current_asset !== 1) {
                        feeConstructor = tx_sender.gawallet.txConstructors[ 1 ][subaccount];
                        refresh.push(feeConstructor.refreshUtxo());
                    }
                    return $q.all(refresh);
                }).then(function() {
                    var destination;
                    if (isConfidential) {
                        destination = {
                            value: satoshis === 'ALL' ?
                                $scope.wallet.final_balance : +satoshis,
                            ctDestination: {
                                b58: to_addr, network: cur_net
                            }
                        }
                    } else {
                        destination = {
                            value: satoshis === 'ALL' ?
                                $scope.wallet.final_balance : +satoshis,
                            scriptPubKey: Bitcoin.bitcoin.address.toOutputScript(
                                to_addr, cur_net
                            )
                        }
                    }
                    return constructor.constructTx(
                          [destination], {
                              signingProgressCallback:
                                  that._signing_progress_cb.bind(that),
                              subtractFeeFromOut: satoshis === 'ALL'
                          }
                    ).then(function(tx) {
                        var fee = calculateFee(tx.tx);
                        var outAmount = satoshis === 'ALL' ?
                            AssetsTransaction.fromHex(tx.tx.toString('hex')).tx.outs[0].value
                            : satoshis;
                        var amountWithFee = +outAmount + (
                            $scope.wallet.current_asset === 1 ? fee : 0
                        );
                        var assetName = $scope.wallet.assets[
                            $scope.wallet.current_asset
                        ].name;
                        return wallets.get_two_factor_code(
                            $scope, 'send_raw_tx', isConfidential ? null : {
                                amount: amountWithFee,
                                // fake change idx for ALL to allow backend to
                                // ignore our wallet outs if we sweep to ourselves
                                change_idx: satoshis === 'ALL' ? 1 : tx.changeIdx,
                                fee: fee,
                                asset: assetName,
                                recipient: to_addr
                            }
                        ).then(function(twofac_data) {
                            if (twofac_data && !isConfidential) {
                                twofac_data.send_raw_tx_amount = amountWithFee;
                                // fake change idx for ALL, as above
                                twofac_data.send_raw_tx_change_idx = satoshis === 'ALL' ? 1 : tx.changeIdx;
                                twofac_data.send_raw_tx_fee = fee;
                                twofac_data.send_raw_tx_asset = assetName;
                                twofac_data.send_raw_tx_recipient = to_addr;
                            }
                            priv_data = {};
                            if (this.memo) {
                                priv_data.memo = this.memo;
                            }
                            return tx_sender.call(
                                'com.greenaddress.vault.send_raw_tx',
                                tx.tx.toString('hex'),
                                twofac_data,
                                priv_data
                            );
                        }.bind(this));

                        function calculateFee (tx_) {
                            var tx = AssetsTransaction.fromHex(tx_.toString('hex'));
                            for (var i = 0; i < tx.tx.fees.length; ++i) {
                              if (tx.tx.fees[i]) return tx.tx.fees[i];
                            }
                        }
                    }.bind(this)).then(function() {
                        $location.url('/info/');
                    });
                }.bind(this)).catch(function(e) {
                    notices.makeNotice('error', gettext('Transaction failed: ') + e && (
                      e.message || (e.args && e.args[1])
                    ));
                }).finally(function() {
                    that.sending = false;
                });
                return;
            } else if (isConfidential) {
                wallets.send_confidential_tx($scope, decoded, satoshis)
                        .finally(function() {
                    $rootScope.decrementLoading();
                    that.sending = false;
                }).then(function() {
                    $location.url('/info/');
                }, function(error) {
                    if (error) {
                        notices.makeNotice('error', error.args ? error.args[1] : error);
                    }
                });
                return;
            }
            var priv_data = {rbf_optin: $scope.wallet.appearance.replace_by_fee && !that.instant,
                             instant: that.instant, allow_random_change: true, memo: this.memo,
                subaccount: $scope.wallet.current_subaccount, prevouts_mode: 'http'};
            if (cur_net.isAlphaMultiasset) {
                priv_data.ga_asset_id = $scope.wallet.current_asset;
            }
            if (that.spend_all) satoshis = $scope.wallet.final_balance;
            tx_sender.call("com.greenaddress.vault.prepare_tx", satoshis, to_addr, this.get_add_fee(), priv_data).then(function(data) {
                var d_verify = verify_tx(that, data.tx, to_addr, satoshis, data.change_pointer).catch(function(error) {
                    sound.play(BASE_URL + "/static/sound/wentwrong.mp3", $scope);
                    notices.makeNotice('error', gettext('Transaction verification failed: ' + error + '. Please contact support.'))
                    return $q.reject();
                });
                that.signing = true;
                return wallets.sign_and_send_tx($scope, data, undefined, undefined, undefined, that._signing_progress_cb.bind(that), d_verify).then(function() {
                    $location.url('/info/');
                });
            }, function(error) {
                if (error && error.args[1]) {
                    notices.makeNotice('error', error.args[1]);
                }
            }).finally(function() { $rootScope.decrementLoading(); that.sending = false; });;
        },
        send_social: function(do_send) {
            var fail_hardware = function() {
                notices.makeNotice('error', gettext('Sorry, vouchers and social transactions are not supported with hardware wallets.'))
                this.sending = false;
                return;
            }
            if (this.voucher) {
                if (!$scope.wallet.hdwallet.keyPair.d) return fail_hardware();
                else return this._send_social(do_send);
            }
            var that = this;
            var name = this.recipient.address;
            tx_sender.call("com.greenaddress.addressbook.user_has_wallet", this.recipient.type, name).then(function(has_wallet) {
                that.recipient.address = name;
                if (has_wallet) {
                    var satoshis = that.amount_to_satoshis(that.amount);
                    that._send_social_ga(satoshis);
                } else {
                    if (!$scope.wallet.hdwallet.keyPair.d) return fail_hardware();
                    that._send_social(do_send);
                }
            }, function(error) {
                that.sending = false;
                notices.makeNotice('error', error.args[1]);
            });
        },
        send_to_payreq: function() {
            var that = this;
            var satoshis = that.amount_to_satoshis(that.amount);
            var data = angular.extend({}, that.recipient.data);
            data.subaccount = $scope.wallet.current_subaccount;
            tx_sender.call("com.greenaddress.vault.prepare_payreq", satoshis, data, {
                    rbf_optin: $scope.wallet.appearance.replace_by_fee,
                    prevouts_mode: 'http'}).then(function(data) {
                that.signing = true;
                return wallets.sign_and_send_tx($scope, data, undefined, undefined, undefined, that._signing_progress_cb.bind(that)).then(function() {
                    $location.url('/info/');
                });
            }, function(error) {
                notices.makeNotice('error', error.args[1]);
            }).finally(function() { that.sending = false; });
        },
        send_money: function() {
            if (!this.spend_all && isNaN(parseFloat(this.amount))) {
                notices.makeNotice('error', gettext('Invalid amount'));
                return;
            }
            if (this.voucher) {
                gaEvent('Wallet', 'SendToVoucher');
                this.send_social(this.do_create_voucher);
                return;
            }
            if (!this.recipient) {
                notices.makeNotice('error', gettext('Please provide a recipient'));
                return;
            }
            this.signing = false;
            this.sending = true;
            if (window.cordova && cordova.platformId == 'ios') {
                // scroll to send button on sending to make sure progress is visible
                // when 'Done' button from iOS keyboard is used
                setTimeout(function() { document.body.scrollTop = document.body.scrollHeight; }, 0);
            }
            this.signing_percentage = 0;
            if (this.recipient.type == 'email') {
                gaEvent('Wallet', 'SendToEmail');
                this.send_social(this.do_send_email.bind(this));
            } else if (this.recipient.type == 'address' || this.recipient.type == 'subaccount') {
                gaEvent('Wallet', 'SendToAddress');
                this.send_address();
            } else if (this.recipient.type == 'payreq') {
                gaEvent('Wallet', 'SendToPaymentRequestSent');
                this.send_to_payreq();
            } else if (this.recipient.constructor === String) {
                if (this.recipient.indexOf('@') != -1) {
                    gaEvent('Wallet', 'SendToNewEmail');
                    this.recipient = {type: 'email', name: this.recipient, address: this.recipient};
                    this.send_social(this.do_send_email.bind(this));
                } else {
                    gaEvent('Wallet', 'SendToNewAddress');
                    this.send_address();
                }
            } else {
                alert('Deprecated recipient type');
            }
        },
        recipient_is_btcaddr: function() {
            return !this.recipient ||
                (this.recipient.constructor === String &&
                    this.recipient.indexOf('@') == -1) ||
                this.recipient.type == 'address' ||
                this.recipient.type == 'payreq' ||
                this.recipient.has_wallet;
        }
    };
    $scope.$watch('send_tx.instant', function(newValue, oldValue) {
        if (newValue) $scope.send_tx.add_fee.per_kb = true;
    });
    var spend_all_succeeded = false;
    $scope.$watch('send_tx.spend_all', function(newValue, oldValue) {
        if (newValue) {
            $scope.send_tx.amount = 'MAX';
        } else {
            $scope.send_tx.amount = '';
        }
    });
    $scope.$watch('send_tx.recipient', function(newValue, oldValue) {
        if (newValue === oldValue || !newValue) return;
        var parsed_uri = parse_bitcoin_uri(newValue);
        if (parsed_uri.r) {
            $scope.send_tx.processing_payreq = true;
            tx_sender.call('com.greenaddress.vault.process_bip0070_url', parsed_uri.r).then(function(data) {
                var amount = 0;
                for (var i = 0; i < data.outputs.length; i++) {
                    var output = data.outputs[i];
                    amount += output.amount;
                }
                $scope.send_tx.amount = satoshisToUnit(amount);
                data.request_url = parsed_uri.r;
                var name = data.merchant_cn || data.request_url;
                $scope.send_tx.recipient = {name: name, data: data, type: 'payreq',
                                            amount: amount, requires_instant: data.requires_instant};
            }).catch(function(err) {
                notices.makeNotice('error', gettext('Failed processing payment protocol request:') + ' ' + err.args[1]);
                $scope.send_tx.recipient = '';
            }).finally(function() { $scope.send_tx.processing_payreq = false; });
        } else if (parsed_uri.amount) {
            $scope.send_tx.amount = btcToUnit(parsed_uri.amount);
        }
    });
    $scope.$watch('send_tx.amount', function(newValue, oldValue) {
        if (newValue !== oldValue) {
            var parsed_uri = $scope.send_tx.recipient && parse_bitcoin_uri($scope.send_tx.recipient);
            var orig_amount = parsed_uri && parsed_uri.amount && btcToUnit(parsed_uri.amount);
            if ($scope.send_tx.recipient && $scope.send_tx.recipient.type == 'payreq') {
                orig_amount = satoshisToUnit($scope.send_tx.recipient.amount);
            }
            if (parsed_uri && orig_amount && newValue != orig_amount) {
                // replace the URI with recipient when amount is changed
                $scope.send_tx.recipient = parsed_uri && parsed_uri.recipient;
            }
        }
    });
    if ($scope.send_tx.recipient && $scope.send_tx.recipient.amount) {
        $scope.send_tx.amount = parseFloat(Bitcoin.Util.formatValue(  // parseFloat required for iOS Cordova
            new Bitcoin.BigInteger($scope.send_tx.recipient.amount.toString()).multiply(Bitcoin.BigInteger.valueOf(mul))));
    }


    $scope.processWalletVars().then(function() {
        $scope.clearWalletInitVars();
        var recipient_override;
        if ($scope.wallet.send_to_receiving_id) {
            gaEvent('Wallet', 'SendToReceivingId');
            var receiving_id = $scope.wallet.send_to_receiving_id;
            $scope.wallet.send_to_receiving_id = undefined;
            recipient_override = {name: receiving_id, address: receiving_id, type: 'address',
                                  amount: $scope.wallet.send_to_receiving_id_amount};
        } else if ($scope.wallet.send_to_payment_request) {
            gaEvent('Wallet', 'SendToPaymentRequestOpened');
            var data = $scope.wallet.send_to_payment_request;
            $scope.wallet.send_to_payment_request = undefined;
            var name = data.merchant_cn || data.request_url;
            recipient_override = {name: name, data: data, type: 'payreq',
                                  amount: $scope.wallet.send_to_receiving_id_amount,
                                  requires_instant: data.requires_instant};
        }
        if (recipient_override) {
            $scope.send_tx.recipient_overridden = true;
            $scope.send_tx.recipient = recipient_override;
            $scope.send_tx.instant = recipient_override.requires_instant;
            if ($scope.send_tx.recipient && $scope.send_tx.recipient.amount) {
                $scope.send_tx.amount = parseFloat(Bitcoin.Util.formatValue(  // parseFloat required for iOS Cordova
                    new Bitcoin.BigInteger($scope.send_tx.recipient.amount.toString()).multiply(Bitcoin.BigInteger.valueOf(mul))));
            }
        }
    });

    wallets.addCurrencyConversion($scope, 'send_tx');
}]);
