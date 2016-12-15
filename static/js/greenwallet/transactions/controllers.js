var Transaction = require('wallet').bitcoinup.Transaction;
var scriptTypes = require('wallet').GA.constants.scriptTypes;
angular.module('greenWalletTransactionsControllers',
    ['greenWalletServices'])
.controller('TransactionsController', ['$scope', 'wallets', 'tx_sender', 'notices', 'branches', '$uibModal', 'gaEvent', '$timeout', '$q', 'encode_key', 'hostname',
        function TransactionsController($scope, wallets, tx_sender, notices, branches, $uibModal, gaEvent, $timeout, $q, encode_key, hostname) {
    // required already by InfoController
    // if(!wallets.requireWallet($scope)) return;

    var calcRedeemAndKeyPairs = function(subaccount, pubkey_pointer) {
        return tx_sender.gaWallet.scriptFactory.createScriptForSubaccountAndPointer(subaccount, pubkey_pointer).then(function (script) {
          var decompiled = Bitcoin.bitcoin.script.decompile(script);
          return {
            redeemScript: script,
            gaKey: decompiled[1],
            userKey: decompiled[2]
          }
        });
    };

    var _redeem = function(transaction) {
        gaEvent('Wallet', 'TransactionsTabRedeem');
        var key = tx_sender.gaWallet.signingWallet.keysManager.getMyPublicKey(
            $scope.wallet.current_subaccount,
            transaction.pubkey_pointer,
            branches.EXTERNAL
        );
        return key.then(function(key) {
            return tx_sender.call("com.greenaddress.vault.prepare_sweep_social",
                    Array.from(key.getPublicKeyBuffer()), false, $scope.wallet.current_subaccount).then(function(data) {
                data.prev_outputs = [];
                for (var i = 0; i < data.prevout_scripts.length; i++) {
                    data.prev_outputs.push(
                        {branch: branches.EXTERNAL, pointer: transaction.pubkey_pointer,
                         subaccount: $scope.wallet.current_subaccount, script: data.prevout_scripts[i]})
                }
                // TODO: verify
                return wallets.sign_and_send_tx($scope, data, {
                  privDer: true, value: -transaction.value
                });
            }).catch(function(error) {
                gaEvent('Wallet', 'TransactionsTabRedeemFailed', error);
                notices.makeError($scope, error);
                return $q.reject(error);
            });
        });
    };
    $scope.redeem = function(transaction) {
        $scope.redeem_transaction = transaction;
        $scope._redeem = function() {
            $scope.redeeming = true;
            _redeem(transaction).then(modal.close).finally(function() {
                $scope.redeeming = false;
            });
        }
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_tx_redeem.html',
            scope: $scope
        });
    }

    $scope.bump_fee = function(transaction, new_feerate, size_override, level) {
        // copy to avoid adding inputs twice if bump is cancelled:
        transaction = angular.copy(transaction);
        level = level || 0;
        if (level > 10) {
            notices.makeNotice('error', 'Recursion limit exceeded.');
            $scope.bumping_fee = false;
            return $q.reject()
        }
        var ret = $q.defer();

        var txsize = (size_override || transaction.size);
        var new_fee = Math.round(txsize * new_feerate / 1000);
        $scope.bumping_fee = true;
        transaction.bumping_dropdown_open = false;
        var bumpedTx = Bitcoin.contrib.transactionFromHex(transaction.rawtx);
        var change_pointer;
        var targetFeeDelta = new_fee - parseInt(transaction.fee);
        var requiredFeeDelta = (
            txsize + 4 * transaction.inputs.length
        ); // assumes mintxfee = 1000, and inputs increasing
           // by at most 4 bytes per input (signatures have variable lengths)
        var feeDelta = Math.max(targetFeeDelta, requiredFeeDelta);
        var remainingFeeDelta = feeDelta;
        var new_fee = parseInt(transaction.fee) + feeDelta;
        var newOuts = [];
        for (var i = 0; i < transaction.outputs.length; ++i) {
            if (transaction.outputs[i].is_relevant) {
                // either change or re-deposit
                if (bumpedTx.outs[i].value < remainingFeeDelta) {
                    // output too small to be decreased - remove it altogether
                    remainingFeeDelta -= bumpedTx.outs[i].value;
                } else {
                    change_pointer = transaction.outputs[i].pubkey_pointer;
                    bumpedTx.outs[i].value -= remainingFeeDelta;
                    remainingFeeDelta = 0;
                    newOuts.push(bumpedTx.outs[i]);
                    bumpedTx.outs[i].pointer = change_pointer;
                    bumpedTx.outs[i].subaccount = wallets.getSubaccount(
                        $scope, transaction.outputs[ i ].subaccount
                    );
                }
            } else {
                // keep the original non-change output
                newOuts.push(bumpedTx.outs[i]);
            }
        }
        bumpedTx.outs = newOuts;

        var builder = Bitcoin.bitcoin.TransactionBuilder.fromTransaction(
            bumpedTx, cur_net
        );
        // reset hashType to allow adding inputs/outputs
        for (var i = 0; i < builder.inputs.length; ++i) {
            delete builder.inputs[i].hashType;
        }
        // keep out pointers for Trezor change detection
        for (var i = 0; i < builder.tx.outs.length; ++i) {
            builder.tx.outs[i].pointer = bumpedTx.outs[i].pointer;
            builder.tx.outs[i].subaccount = bumpedTx.outs[i].subaccount;
        }
        function setPrototypeOf (obj, proto) {
          obj.__proto__ = proto
          return obj
        }
        setPrototypeOf = Object.setPrototypeOf || setPrototypeOf
        // (Not really alpha, but we need the same changes allowing signatures
        //  to be deferreds.)
        setPrototypeOf(
            builder,
            Bitcoin.contrib.AlphaTransactionBuilder.prototype
        );

        var builder_d;
        if (remainingFeeDelta > 0) {
            builder_d = tx_sender.call(
                'com.greenaddress.txs.get_all_unspent_outputs',
                1,  // do not include zero-confs (RBF requirement)
                $scope.wallet.current_subaccount
            ).then(function(utxos) {
                var required_utxos = [];
                for (var i = 0; i < utxos.length; ++i) {
                    remainingFeeDelta -= utxos[i].value;
                    required_utxos.push(utxos[i]);
                    if (remainingFeeDelta <= 0) break;
                }
                var change_d = $q.when();
                if (remainingFeeDelta < 0) {
                    // new change output needs to be added
                    change_d = tx_sender.call(
                        'com.greenaddress.vault.fund',
                        $scope.wallet.current_subaccount, true, true
                    ).then(function(data) {
                        change_pointer = data.pointer;
                        return Bitcoin.bitcoin.crypto.hash160(
                            new Bitcoin.Buffer.Buffer(data.script, 'hex')
                        );
                    })
                } else if (remainingFeeDelta == 0) {
                    // if we were lucky enough to match the required value,
                    // no new change output is necessary
                    change_d = $q.when(null);
                } else {   // remainingFeeDelta > 0
                    return $q.reject(gettext("Not enough money"));
                }
                return change_d.then(function(change_hash160) {
                    if (change_hash160) {
                        builder.addOutput(
                            Bitcoin.bitcoin.script.scriptHashOutput(
                                change_hash160
                            ),
                            -remainingFeeDelta
                        );
                        var out = builder.tx.outs[builder.tx.outs.length - 1];
                        out.pointer = change_pointer;
                        out.subaccount = wallets.getSubaccount(
                            $scope, $scope.wallet.current_subaccount
                        );
                    }
                    var utxos_ds = [];
                    for (var i = 0; i < required_utxos.length; ++i) {
                        var requtxo = required_utxos[i];
                        utxos_ds.push(calcRedeemAndKeyPairs(
                            $scope.wallet.current_subaccount,
                            requtxo.pointer
                        ));
                    }
                    return $q.all(utxos_ds).then(function(utxos) {
                        for (var i = 0; i < required_utxos.length; ++i) {
                            var requtxo = required_utxos[i];
                            builder.addInput(
                                [].reverse.call(new Buffer(
                                    requtxo.txhash, 'hex'
                                )),
                                requtxo.pt_idx,
                                0,
                                Bitcoin.bitcoin.script.scriptHashOutput(
                                    Bitcoin.bitcoin.crypto.hash160(
                                        utxos[i].redeemScript
                                    )
                                )
                            )
                        }
                        // add estimated prevscript + signatures + scripts
                        // length (72[prevout] + 74[sig] * 2 for each input)
                        var new_size = builder.tx.byteLength() + builder.tx.ins.length * (72 + 74 * 2);
                        if (Math.round(new_size * new_feerate / 1000) > new_fee) {
                            ret.resolve($scope.bump_fee(
                                transaction, new_feerate, new_size, level + 1
                            ));
                            return;
                        }
                        var requiredFeeDelta = (
                            new_size + 4 * transaction.inputs.length
                        );
                        if (parseInt(transaction.fee) + requiredFeeDelta > new_fee) {
                            ret.resolve($scope.bump_fee(
                                transaction, new_feerate, new_size, level + 1
                            ));
                            return;
                        }
                        // add inputs to transaction.inputs only if it passed
                        // the above checks -- otherwise the recursive call
                        // would have duplicate inputs in transaction.inputs
                        for (var i = 0; i < required_utxos.length; ++i) {
                            var requtxo = required_utxos[i];
                            transaction.inputs.push(
                                {pubkey_pointer: requtxo.pointer}
                            );
                        }
                        return builder;
                    });
                })
            });
        } else {
            builder_d = $q.when(builder);
        }

        builder_d.then(function(builder) {
            if (!builder) return;  // recursive call to bump_fee above

            var modal_d = wallets.ask_for_tx_confirmation(
                $scope, builder.tx,
                {fee: parseInt(transaction.fee) + feeDelta,
                 bumped_tx: transaction,
                 recipient: transaction.description_short}
            );

            var prev_outputs = [];
            var in2out_types = {};
            in2out_types[scriptTypes.REDEEM_P2SH] = scriptTypes.OUT_P2SH;
            in2out_types[scriptTypes.REDEEM_P2SH_P2WSH] = scriptTypes.OUT_P2SH_P2WSH;
            for (var i = 0; i < transaction.inputs.length; ++i) {
                (function(utxo) {
                    prev_outputs.push(calcRedeemAndKeyPairs(
                        $scope.wallet.current_subaccount,
                        utxo.pubkey_pointer
                    ).then(function(res) {
                        return {
                            branch: branches.REGULAR,
                            subaccount: $scope.wallet.current_subaccount,
                            script_type: in2out_types[utxo.script_type],
                            pointer: utxo.pubkey_pointer,
                            value: +utxo.value,
                            script: res.redeemScript.toString('hex')
                        }
                    }));
                })(transaction.inputs[i]);
            }

            var signatures_d = $q.all(prev_outputs).then(function(res) {
                builder.tx.ins.forEach(function(inp, i) {
                  var prevOut = res[i];
                  inp.prevOut = {
                    subaccount: wallets.getSubaccount(
                      $scope, $scope.wallet.current_subaccount
                    ),
                    value: prevOut.value,
                    raw: {
                      script_type: prevOut.script_type,
                      branch: prevOut.branch,
                      pointer: prevOut.pointer,
                      txhash: Bitcoin.bitcoin.bufferutils.reverse(
                        inp.hash
                      ).toString('hex')
                    }
                  }
                });
                var tx = new Transaction();
                tx.tx = builder.tx;
                var constructor = tx_sender.gaWallet.txConstructors[
                  $scope.wallet.current_asset
                ][
                  $scope.wallet.current_subaccount
                ];
                return tx_sender.gaWallet.signingWallet.signTransaction(
                  tx,
                  {utxoFactory: constructor.utxoFactory}
                ).then(function () {
                  return tx
                });
            });

            var signatures_and_modal = modal_d.then(function() {
                return signatures_d;
            });

            ret.resolve(signatures_and_modal.then(function (tx) {
                var try_sending = function(twofac_data) {
                    return tx_sender.call(
                        'com.greenaddress.vault.send_raw_tx',
                        tx.toBuffer().toString('hex'), twofac_data
                    ).then(function(data) {
                        if (data.new_limit) {
                            $scope.wallet.limits.total = data.new_limit;
                        }
                    });
                };

                // try without 2FA to see if it's required
                // (could be bump amount under the user-defined 2FA threshold)
                return try_sending({
                    'try_under_limits_bump': feeDelta
                }).catch(function(e) {
                    if (e.args && e.args[0] &&
                            e.args[0] == "http://greenaddressit.com/error#auth") {
                        return wallets.attempt_two_factor(
                            $scope, 'bump_fee', {data: {amount: feeDelta}}, function(twofac_data) {
                            twofac_data.bump_fee_amount = feeDelta;
                            return try_sending(twofac_data);
                        });
                    } else {
                        return $q.reject(e);
                    }
                });
            }).catch(function(e) {
                notices.makeError($scope, e);
            }).finally(function() {
                $scope.bumping_fee = false;
            }));
        }).catch(function(e) {
            $scope.bumping_fee = false;
            notices.makeNotice('error', e.args ? e.args[1] : e);
        });
        return ret;
    };

    $scope.edit_tx_memo = function(tx) {
        if (tx.new_memo == tx.memo) {
            // nothing to do
            tx.changing_memo = false;
        } else {
            tx_sender.call('com.greenaddress.txs.change_memo', tx.txhash, tx.new_memo).then(function() {
                tx.memo = tx.new_memo;
                tx.changing_memo = false;
            }, function(err) {
                notices.makeNotice('error', err.args[1]);
            });
        }
    };

    $scope.start_editing_tx_memo = function(tx) {
        tx.changing_memo = true;
        tx.new_memo = tx.memo;
    };

    $scope.details = function(transaction) {
        gaEvent('Wallet', 'TransactionsTabDetailsModal');
        $scope.selected_transaction = transaction;
        var current_estimate = 25, best_estimate;
        if ($scope.wallet.fee_estimates) {
            var keys = Object.keys($scope.wallet.fee_estimates).sort();
            for (var i = 0; i < keys.length; ++i) {
                var estimate = $scope.wallet.fee_estimates[keys[i]];
                if (i == 0) best_estimate = estimate.blocks;
                var feerate = estimate.feerate * 1000 * 1000 * 100;
                var estimated_fee = Math.round(
                    feerate * transaction.size / 1000
                );
                // If cur fee is already above estimated, don't suggest it.
                // Needs to be checked early to avoid suggesting the minimum of
                // tx.fee + tx.size needlessly.
                if (parseInt(transaction.fee) >= estimated_fee) {
                    current_estimate = estimate.blocks
                    break;
                }
            }
            transaction.current_estimate = current_estimate;
        }
        if (transaction.has_payment_request && !transaction.payment_request) {
            tx_sender.call('com.greenaddress.txs.get_payment_request', transaction.txhash).then(function(payreq_b64) {
                transaction.payment_request = 'data:application/bitcoin-paymentrequest;base64,' + payreq_b64;
            });
        }
        $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_tx_details.html',
            scope: $scope
        })
    };

    $scope.toggle_transaction_search = function() {
        $scope.search_visible = !$scope.search_visible;
    }

}]);
