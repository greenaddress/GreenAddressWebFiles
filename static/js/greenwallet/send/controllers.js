angular.module('greenWalletSendControllers',
    ['greenWalletServices'])
.controller('SendController', ['$scope', 'wallets', 'tx_sender', 'cordovaReady', 'notices', 'branches', 'wallets', 'storage', 'storage_keys', '$routeParams', 'hostname', 'gaEvent', '$uibModal', '$location', '$rootScope', '$q', 'parse_bitcoin_uri', 'qrcode', 'sound', 'encode_key',
         function SendController($scope, wallets, tx_sender, cordovaReady, notices, branches, wallets, storage, storage_keys, $routeParams, hostname, gaEvent, $uibModal, $location, $rootScope, $q, parse_bitcoin_uri, qrcode, sound, encode_key) {
    if (!wallets.requireWallet($scope)) return;
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
            var _this = this;
            $rootScope.safeApply(function () {
                _this.signing = true;
                _this.signing_percentage = Math.max(_this.signing_percentage, progress);
            });
        },
        add_fee: {'party': 'sender',
                  'per_kb': true,
                  'amount': '',
                  'requiredNumOfBlocks': $scope.wallet.appearance.required_num_blocks},
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
        send_address: function() {
            var that = this;
            var to_addr = this.recipient.constructor === String ? this.recipient : this.recipient.address;
            var parsed_uri = parse_bitcoin_uri(to_addr);
            if (parsed_uri.recipient) to_addr = parsed_uri.recipient;
            var addrDeferred, isConfidential;
            if (to_addr.indexOf('GA') === 0) {
                addrDeferred = tx_sender.call(
                    'com.greenaddress.vault.fund_receiving_id', to_addr
                ).then(function(p2sh) {
                    to_addr = p2sh;
                });
            } else {
                try {
                    var decoded = Bitcoin.bs58check.decode(to_addr);
                } catch (e) {
                    notices.makeNotice('error', gettext('Invalid address'));
                    that.sending = false;
                    return;
                }
                isConfidential = (decoded[0] == 25 || decoded[0] == 10);
            }
            var satoshis =
                this.spend_all ? "ALL" : this.amount_to_satoshis(this.amount);
            $rootScope.is_loading += 1;
            var constructor;
            var subaccount = $scope.wallet.current_subaccount || 0;
            constructor = tx_sender.gaWallet.txConstructors[$scope.wallet.current_asset][subaccount];
            // constructors are only available when connected
            var refreshAndAddr = [constructor.refreshUtxo()];
            var feeConstructor;
            if ($scope.wallet.current_asset !== 1) {
                feeConstructor = tx_sender.gaWallet.txConstructors[ 1 ][subaccount];
                refreshAndAddr.push(feeConstructor.refreshUtxo());
            }
            if (addrDeferred) {
                refreshAndAddr.push(addrDeferred);
            }
            return $q.all(refreshAndAddr).then(function() {
                var destination;
                if (isConfidential) {
                    destination = {
                        value: satoshis === 'ALL' ?
                            +$scope.wallet.final_balance : +satoshis,
                        ctDestination: {
                            b58: to_addr, network: cur_net
                        }
                    }
                } else {
                    destination = {
                        value: satoshis === 'ALL' ?
                            +$scope.wallet.final_balance : +satoshis,
                        scriptPubKey: Bitcoin.bitcoin.address.toOutputScript(
                            to_addr, cur_net
                        )
                    }
                }
                var addFee;
                var isMinFeeRate = false;
                if (that.add_fee.amount !== '') {
                  addFee = {
                    isConstant: !that.add_fee.per_kb,
                    amount: +that.amount_to_satoshis(that.add_fee.amount)
                  };
                  var minFeeRate = tx_sender.gaService.getMinFeeRate();
                  if (!addFee.isConstant && addFee.amount < minFeeRate) {
                    addFee.amount = minFeeRate;
                    isMinFeeRate = true;
                  } else if (addFee.isConstant && !$scope.wallet.appearance.replace_by_fee) {
                    throw new Error('Custom fees require transaction replacement functionality to be enabled.');
                  }
                } else if (that.instant) {
                  addFee = {
                    // backend constants:
                    requiredNumOfBlocks: 3,
                    multiplier: 2
                  };
                } else if (that.add_fee.requiredNumOfBlocks) {
                  addFee = {
                    requiredNumOfBlocks: that.add_fee.requiredNumOfBlocks,
                    multiplier: 1
                  };
                }
                var tx;
                return constructor.constructTx(
                    [destination], {
                        signingProgressCallback:
                            that._signing_progress_cb.bind(that),
                        subtractFeeFromOut: satoshis === 'ALL',
                        rbfOptIn: $scope.wallet.appearance.replace_by_fee,
                        minConfs: that.instant ? 6 : (window.cur_net === Bitcoin.bitcoin.networks.testnet ? 0 : 1),
                        addFee: addFee,
                        locktime: $scope.wallet.cur_block,
                        minimizeInputs: wallets.getSubaccount(
                            $scope, $scope.wallet.current_subaccount
                        ).type === '2of3'
                    }
                ).then(function(tx_) {
                    if ($scope.wallet.appearance.use_segwit && tx_.segwit_change === true) {
                        storage.set($scope.wallet.segwit_locked_key, true);
                    }
                    tx = tx_;
                    // utxo data is necessary for the confirmation modal
                    return constructor.utxoFactory.fetchUtxoDataForTx(tx.tx);
                }).then(function() {
                    return wallets.ask_for_tx_confirmation(
                        $scope, tx.tx, {is_min_fee_rate: isMinFeeRate}
                    );
                }).then(function () {
                    var fee = calculateFee(tx.tx);
                    var outAmount = satoshis === 'ALL' ?
                        tx.tx.outs[0].value : satoshis;
                    var amountWithFee = +outAmount + (
                        $scope.wallet.current_asset === 1 ? fee : 0
                    );
                    var asset = $scope.wallet.assets[
                        $scope.wallet.current_asset
                    ];
                    var assetName = asset ? asset.name : 'BTC';
                    if ($scope.wallet.limits.is_fiat || $scope.wallet.limits.total >= amountWithFee) {
                        return attempt({try_under_limits_spend: {
                            amount: amountWithFee,
                            fee: fee,
                            change_idx: satoshis === 'ALL' ? 1 : tx.changeIdx
                        }}).catch(function (err) {
                            if (err.args && err.args[0] === 'http://greenaddressit.com/error#auth') {
                                return attempt2FA();
                            } else {
                                return Promise.reject(err);
                            }
                        });
                    } else {
                        return attempt2FA();
                    }

                    function attempt2FA () {
                        return wallets.attempt_two_factor(
                            $scope, 'send_raw_tx', {data: isConfidential ? null : {
                                amount: amountWithFee,
                                // fake change idx for ALL to allow backend to
                                // ignore our wallet outs if we sweep to ourselves
                                change_idx: satoshis === 'ALL' ? 1 : tx.changeIdx,
                                fee: fee,
                                asset: assetName,
                                recipient: to_addr
                            }}, attempt
                        );
                    }

                    function calculateFee (tx) {
                        if (cur_net.isAlphaMultiasset) {
                            for (var i = 0; i < tx.fees.length; ++i) {
                               if (tx.fees[ i ]) return tx.fees[ i ];
                            }
                        } else {
                            return tx.ins.reduce(function (a, b) {
                              return a + b.prevOut.value;
                            }, 0) - tx.outs.reduce(function (a, b) {
                              return a + b.value;
                            }, 0);
                        }
                    }
                    function attempt(twofac_data) {
                        if (twofac_data && !twofac_data.try_under_limits_spend && !isConfidential) {
                            twofac_data.send_raw_tx_amount = amountWithFee;
                            // fake change idx for ALL, as above
                            twofac_data.send_raw_tx_change_idx = satoshis === 'ALL' ? 1 : tx.changeIdx;
                            twofac_data.send_raw_tx_fee = fee;
                            twofac_data.send_raw_tx_asset = assetName;
                            twofac_data.send_raw_tx_recipient = to_addr;
                        }
                        var priv_data = {};
                        if (that.memo) {
                            priv_data.memo = that.memo;
                        }
                        if (that.instant) {
                            priv_data.instant = true;
                        }
                        return tx_sender.call(
                            'com.greenaddress.vault.send_raw_tx',
                            tx.toBuffer().toString('hex'),
                            twofac_data,
                            priv_data
                        ).then(function (data) {
                            if (data.new_limit) {
                                $scope.wallet.limits.total = data.new_limit;
                            }
                        })
                    }
                }.bind(this)).then(function() {
                    $location.url('/info/');
                }.bind(this)).catch(function (e) {
                  if (e && e != 'escape key press') {
                    notices.makeError($scope, e);
                  } else {
                    console.log('dialog dismissed');
                  }
                });
            }.bind(this)).catch(function(e) {
                notices.makeError($scope, e);
            }).finally(function() {
                that.sending = false;
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
                var progressCb = that._signing_progress_cb.bind(that);
                return wallets.sign_and_send_tx(
                    $scope, data,
                    {signingProgressCallback: progressCb}
                ).then(function() {
                    $location.url('/info/');
                });
            }, function(error) {
                notices.makeNotice('error', error.args[1]);
            }).finally(function() { that.sending = false; });
        },
        send_money: function() {
            if (!this.spend_all && (isNaN(parseFloat(this.amount)) || this.amount <= 0)) {
                notices.makeNotice('error', gettext('Invalid amount'));
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
            if (this.recipient.type == 'address' || this.recipient.type == 'subaccount') {
                gaEvent('Wallet', 'SendToAddress');
                this.send_address();
            } else if (this.recipient.type == 'payreq') {
                gaEvent('Wallet', 'SendToPaymentRequestSent');
                this.send_to_payreq();
            } else if (this.recipient.constructor === String) {
                gaEvent('Wallet', 'SendToNewAddress');
                this.send_address();
            } else {
                notices.makeNotice('error', 'Unsupported recipient type');
                this.sending = false;
            }
        }
    };
    $scope.$watch('wallet.current_subaccount', function(newValue, oldValue) {
        var subaccount = {type: 'main'};
        for (var k in $scope.wallet.subaccounts)
            if ($scope.wallet.subaccounts[k].pointer === newValue)
                subaccount = $scope.wallet.subaccounts[k];
        $scope.send_tx.current_subaccount_type = subaccount.type;
        if (subaccount.type === '2of3') {
            $scope.send_tx.instant = false;
        }
    });
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
