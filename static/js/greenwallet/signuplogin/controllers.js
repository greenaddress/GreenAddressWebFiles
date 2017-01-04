var extend = require('xtend/mutable');
angular.module('greenWalletSignupLoginControllers', ['greenWalletMnemonicsServices'])
.controller('SignupLoginController', ['$scope', '$uibModal', 'focus', 'wallets', 'notices', 'mnemonics', '$location', 'cordovaReady', 'tx_sender', 'crypto', 'gaEvent', 'storage', 'storage_keys', 'qrcode', '$timeout', '$q', 'trezor', 'bip38', 'btchip', '$interval', '$rootScope', 'hw_wallets',
        function SignupLoginController($scope, $uibModal, focus, wallets, notices, mnemonics, $location, cordovaReady, tx_sender, crypto, gaEvent, storage, storage_keys, qrcode, $timeout, $q, trezor, bip38, btchip, $interval, $rootScope, hw_wallets) {

    var allHwWallets = hw_wallets.allHwWallets;
    var BaseHWWallet = hw_wallets.BaseHWWallet;

    if (window.GlobalWalletControllerInitVars) {
        // in case user goes back from send to login and back to send, we want to display the
        // send data again
        window.WalletControllerInitVars = window.GlobalWalletControllerInitVars;
    }

    $scope.install_run_app_label = "";
    var appInstalled = false;
    if (!(cur_net.isAlpha || cur_net.isSegwit) && window.chrome && chrome.app && !chrome.storage) {
        if (chrome.runtime) {
            chrome.runtime.sendMessage(
                $('link[rel="chrome-webstore-item"]').attr('href').split('/detail/')[1],
                {greeting: true}, function(response) {
                    appInstalled = (response == "GreenAddress installed");
                    if (appInstalled) {
                        $scope.$apply(function() {
                            $scope.install_run_app_label = gettext("Launch the Chrome App")
                        });
                    }
                }
            );
        }
        $scope.install_run_app_label = gettext("Install the Chrome App")
    }
    $scope.install_run_app = function(ev) {
        if (!(cur_net.isAlpha || cur_net.isSegwit) && window.chrome && chrome.app && !chrome.storage) {
            // !chrome.storage means we're not inside the chrome app
            ev.preventDefault();
            if (appInstalled) {
                window.location.href = "/launch_chrome_app_signup/";
                return;
            }
            try {
                chrome.webstore.install();
            } catch (e) {
                location.href = $('link[rel="chrome-webstore-item"]').attr('href')
            }
        }
    }

    storage.set(storage_keys.LAST_VISIT, new Date().toISOString());

    var state = {};
    storage.get([
            storage_keys.PIN_ID+'_touchid',
            storage_keys.ENCRYPTED_SEED+'_touchid',
            storage_keys.PIN_ID,
            storage_keys.ENCRYPTED_SEED,
            storage_keys.PIN_REFUSED
    ]).then(function(data) {
        if (data[storage_keys.PIN_ID+'_touchid']) {
            document.addEventListener('deviceready', function() {
                cordova.exec(function(param) {
                    $scope.$apply(function() {
                        use_pin_data.pin = param;
                        $scope.logging_in = true;
                        setTimeout(function() {
                            $scope.use_pin('_touchid').finally(function() {
                                $scope.logging_in = false;
                            });
                        }, 0);
                    });
                }, function(fail) {
                    console.log('CDVTouchId.getSecret failed: ' + fail)
                }, "CDVTouchId", "getSecret", []);
            });
        }
        tx_sender.has_pin = state.has_pin = !!(
            data[storage_keys.PIN_ID] && data[storage_keys.ENCRYPTED_SEED]
        );
        state.refused_pin = data[storage_keys.PIN_REFUSED] || storage.noLocalStorage;  // don't show the PIN popup if no storage is available
        state.toggleshowpin = !state.has_pin;
        // Setup errors can cause ident to be set, but encrypted_seed to be
        // missing, so we set the ident only if encrypted_seed is set too,
        // to avoid wrongfully assuming the PIN is set.
        if (state.has_pin) {
            state.pin_ident = data[storage_keys.PIN_ID];
            state.encrypted_seed = data[storage_keys.ENCRYPTED_SEED];
        }
        if (data.pin_ident_touchid && data.encrypted_seed_touchid) {
            state.pin_ident_touchid = data[storage_keys.PIN_ID+'_touchid'];
            state.encrypted_seed_touchid = data[storage_keys.ENCRYPTED_SEED+'_touchid'];
        }
        $timeout(function() {
            if (state.has_pin) {
                focus('pin');
            } else {
                focus('mnemonic');
            }
        });

        if (state.has_pin && window.cordova && cordova.platformId == 'android') {
            cordovaReady(function() {
                cordova.exec(function(param) {
                    $scope.$apply(function() {
                        use_pin_data.pin = param;
                        $scope.logging_in = true;
                        $scope.use_pin().finally(function() {
                            $scope.logging_in = false;
                        });
                    });
                }, function(fail) {
                    state.toggleshowpin = true;
                }, "PINInput", "show_input", []);
            })();
        }
    });
    if ($scope.wallet) {
        $scope.wallet.signup = false;  // clear signup state
    }
    $scope.state = state;
    if (!('toggleshowpin' in state)) {
        state.toggleshowpin = true;
    }
    state.toggleshowpassword = false;
    var modal;
    var decrypt_bytes = function(bytes) {
        var d = $q.defer();
        $scope.decrypt_password_modal = {
            decrypt: function() {
                this.error = undefined;
                if (!this.password) {
                    this.error = gettext('Please provide a password.');
                    return;
                }
                this.decrypting = true;
                var that = this;
                bip38.processMessage({password: this.password, mnemonic_encrypted: bytes}).then(function(message) {
                    if (message.data.error) {
                        that.decrypting = false;
                        that.error = message.data.error;
                    } else {
                        mnemonics.toMnemonic(message.data).then(function(mnemonic) {
                            that.decrypting = false;
                            d.resolve(mnemonic);
                            modal.close();
                        });
                    }
                }, function(err) { that.error = err; that.decrypting = false; });
            }
        };
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signuplogin/modal_decryption_password.html',
            scope: $scope
        });
        modal.opened.then(function() { focus('decryptPasswordModal'); })
        return d.promise;
    };

    $scope.login = function() {
        if ($scope.logging_in || (!state.mnemonic && !use_pin_data.pin)) {
            return;
        }

        $scope.logging_in = true;

        if (use_pin_data.pin) {
            gaEvent('Login', 'PinLogin');
            $scope.use_pin().finally(function() {
                $scope.logging_in = false;
            });
            return;
        }
        state.mnemonic = state.mnemonic.trim();
        var encrypted = state.mnemonic.split(" ").length == 27;
        gaEvent('Login', encrypted ? 'MnemonicLogin' : 'MnemonicEncryptedLogin');
        state.mnemonic_error = state.login_error = undefined;
        var mnemonic_words = state.mnemonic.split(' ');
        var last_word = mnemonic_words[mnemonic_words.length-1];
        // BTChip seed ends with 'X':
        if (last_word.indexOf('X') == last_word.length-1) {
            var login_data_d = $q.when({seed: last_word.slice(0, -1)});
        } else {
            var login_data_d = mnemonics.validateMnemonic(state.mnemonic).then(function() {
                var process = function(mnemonic) {
                    return mnemonics.toSeed(mnemonic).then(function(seed) {
                        return mnemonics.toSeed(mnemonic, 'greenaddress_path').then(function(path_seed) {
                            return {seed: seed, path_seed: path_seed, mnemonic: mnemonic};
                        }, undefined, function(progress) {
                            state.seed_progress = Math.round(50 + progress/2);
                        });
                    }, undefined, function(progress) {
                        state.seed_progress = Math.round(progress/2);
                    }).catch(function() {
                        state.seed_progress = undefined;
                    });
                };
                if (!encrypted) {
                    return process(state.mnemonic);
                } else {
                    return mnemonics.fromMnemonic(state.mnemonic).then(function(mnemonic_data) {
                        return decrypt_bytes(mnemonic_data);
                    }).then(process);
                }
            });
        }
        return login_data_d.then(function(data) {
            return $q.when(Bitcoin.bitcoin.HDNode.fromSeedHex(data.seed, cur_net)).then(function(hdwallet) {
                // seed, mnemonic, and path seed required already here for PIN setup below
                $scope.wallet.logged_in_with_encrypted_mnemonics = encrypted;
                state.seed_progress = 100;
                state.seed = data.seed;
                var needsPINSetup = !state.has_pin && !state.refused_pin;
                var pathSeed = {};
                if (data.path_seed) {
                    // absent when logging in with btchip seed string
                    pathSeed.pathSeed = new Bitcoin.Buffer.Buffer(data.path_seed, 'hex')
                }
                return wallets.loginWithHDWallet(
                    $scope, hdwallet, extend({
                        mnemonic: data.mnemonic,
                        seed: new Bitcoin.Buffer.Buffer(data.seed, 'hex'),
                        // conditionally disable automatic redirect to the
                        // initial wallet page, to avoid closing the PIN modal:
                        needsPINSetup: needsPINSetup
                    }, pathSeed)
                ).then(function(data) {
                    if (!data) {
                        gaEvent('Login', 'MnemonicLoginFailed');
                        state.login_error = true;
                    } else {
                        gaEvent('Login', 'MnemonicLoginSucceeded');
                    }
                    return data;
                }).then(function (data) {
                    if (data && needsPINSetup) {
                        gaEvent('Login', 'MnemonicLoginPinModalShown');
                        modal = $uibModal.open({
                            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_pin.html',
                            scope: $scope
                        });
                        modal.opened.then(function() { focus("pinModal"); });
                        return modal.result.finally(function() {
                            storage.set(storage_keys.PIN_REFUSED, true);
                            // Open initial page only after the modal is closed,
                            // otherwise it'd close itself on navigation.
                            wallets.openInitialPage($scope.wallet, data.has_txs);
                        });
                    }
                }).finally(function () {
                    $scope.logging_in = false;
                    state.seed_progress = 0;
                });
            });
        }, function(e) {
            gaEvent('Login', 'MnemonicError', e);
            state.mnemonic_error = e;
        }).finally(function() {
            $scope.logging_in = false;
        });
    };

    $scope.window = window;
    $scope.$watch('window.GA_NFC_LOGIN_DATA', function(newValue, oldValue) {
        var nfc_bytes = newValue;
        if (nfc_bytes) {
            window.GA_NFC_LOGIN_DATA = undefined;
            var login_with_mnemonic = function(mnemonic) {
                state.mnemonic = mnemonic;
                state.toggleshowpin = true;
                $scope.login();
            }
            if (nfc_bytes.length == 36) {  // encrypted
                gaEvent('Login', 'NfcEncryptedLogin');
                decrypt_bytes(nfc_bytes).then(login_with_mnemonic);
            } else {
                gaEvent('Login', 'NfcLogin');
                mnemonics.toMnemonic(nfc_bytes).then(function(mnemonic) {
                    login_with_mnemonic(mnemonic);
                });
            }
        }
    });

    if (state.has_pin && state.toggleshowpin) {
        focus('pin');
    }

    $scope.$watch('state.toggleshowpin', function(newValue, oldValue) {
        if (newValue) use_pin_data.pin = '';
    });

    $scope.set_pin = function set_pin(valid) {
        if (!valid) {
            $scope.state.error = true;
        } else {
            wallets.create_pin(state.new_pin_value, $scope).then(function() {
                gaEvent('Login', 'PinSet');
                modal.close();
            }, function(error) {
                var message = (error && error.args) ? error.args[1] : error;
                gaEvent('Login', 'PinSettingError', message);
                notices.makeNotice('error', message);
            });
        }
    };

    $scope.login_with_custom = function() {
        gaEvent('Login', 'CustomLogin');
        $scope.got_username_password = function(username, password) {
            wallets.loginWatchOnly($scope, 'custom', {username: username, password: password}).then(function() {
                gaEvent('Login', 'CustomLoginSucceeded');
                modal.close();
            }).catch(function(e) {
                gaEvent('Login', 'CustomLoginFailed', e.args[1]);
                notices.makeNotice('error', e.args[1]);
            });
        };
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_custom_login.html',
            scope: $scope
        });
        modal.rendered.then(function() {
            focus('customLoginModal');
        });
    };

    var hwDevice = null;

    $scope.login_with_hw = function() {
        gaEvent('Login', 'HardwareLogin');
        // new refactored implementation, unfinished
        var opts = {progressCb: progressCb};
        $scope.logging_in = true;
        wallets.loginWithHWWallet($scope, hwDevice, opts).catch(function(err) {
            notices.makeError($scope, err);
            $scope.logging_in = false;
        });

        function progressCb (progress) {
            $rootScope.safeApply (function () {
                $scope.hardware_progress = progress;
            });
        }
    };

    var template = gettext("{hardware_wallet_name} Login");
    hw_wallets.checkDevices(tx_sender.gaService.netName).then(function (dev) {
        state.hw_detected = template.replace('{hardware_wallet_name}', dev.deviceTypeName);
        hwDevice = dev;
    }, function (err) {
        notices.makeNotice('error', err.message);
    });

    $scope.read_qr_code = function read_qr_code($event) {
        gaEvent('Login', 'QrScanClicked');
        qrcode.scan($scope, $event, '_login').then(function(text) {
            gaEvent('Login', 'QrScanningSucceeded');
            state.mnemonic = text;
            return $scope.login();
        }, function(error) {
            gaEvent('Login', 'QrScanningFailed', error);
            notices.makeNotice('error', error);
        });
    };
    $scope.stop_scanning_qr_code = function() {
        qrcode.stop_scanning($scope);
    }

    var use_pin_data = $scope.use_pin_data = {};

    var pin_attempts_left = 3;
    $scope.use_pin = function(storage_suffix) {
        try {
            return $scope._use_pin(storage_suffix)
        } catch (e) {
            return Promise.reject(e);
        }
    };
    $scope._use_pin = function(storage_suffix) {
        storage_suffix = storage_suffix || '';
        notices.setLoadingText("Checking PIN");
        return tx_sender.call('com.greenaddress.pin.get_password', use_pin_data.pin, state['pin_ident'+storage_suffix]).then(
            function(password) {
                if (!password) {
                    gaEvent('Login', 'PinLoginFailed', 'empty password');
                    state.login_error = true;
                    return;
                }
                if (!storage_suffix) {
                    // necessary for PIN change after reconnect (see "resend
                    // "PIN to allow PIN changes in the event of reconnect"
                    // in services.js)
                    // NOTE: do not set tx_sender.pin_ident unless
                    // authentication succeeded, otherwise all reconnections
                    // will fail.
                    tx_sender.pin = use_pin_data.pin;
                    tx_sender.pin_ident = state.pin_ident;
                }
                var check_storage_chaincode = function (chainCode) {
                    storage.get(storage_keys.PIN_CHAINCODE+storage_suffix).then(function(chaincode) {
                        if (!chaincode) {
                            storage.set(
                                storage_keys.PIN_CHAINCODE+storage_suffix,
                                chainCode.toString('hex')
                            );
                        }
                    });
                }
                return crypto.decrypt(state['encrypted_seed'+storage_suffix], password).then(function(decoded) {
                    if(decoded && JSON.parse(decoded).seed) {
                        gaEvent('Login', 'PinLoginSucceeded');
                        var parsed = JSON.parse(decoded);
                        return $q.when(Bitcoin.bitcoin.HDNode.fromSeedHex(parsed.seed, cur_net)).then(function(hd) {
                            return wallets.loginWithHDWallet(
                                $scope, hd, {
                                    mnemonic: parsed.mnemonic,
                                    seed: new Bitcoin.Buffer.Buffer(parsed.seed, 'hex'),
                                    pathSeed: new Bitcoin.Buffer.Buffer(parsed.path_seed, 'hex')
                                }
                            ).then(function () {
                                tx_sender.gaWallet.signingWallet.getChainCode().then(
                                    check_storage_chaincode
                                );
                                if (!parsed.path_seed) {
                                    // cache the path seed (for old PINs that didn't include it)
                                    return tx_sender.gaWallet.signingWallet.keysManager.privHDWallet.derivePathSeed().then(function(path_seed) {
                                        parsed.path_seed = path_seed.toString('hex');
                                        crypto.encrypt(JSON.stringify(parsed), password).then(function (encrypted) {
                                            storage.set(storage_keys.ENCRYPTED_SEED+storage_suffix, encrypted);
                                        })
                                    });
                                }
                            });
                        });
                    } else {
                        gaEvent('Login', 'PinLoginFailed', 'Wallet decryption failed');
                        state.login_error = true;
                        notices.makeNotice('error', gettext('Wallet decryption failed'));
                    }
                });
            }, function(e) {
                gaEvent('Login', 'PinLoginFailed', e.args[1]);
                var suffix = '';
                if (e.args[0] == "http://greenaddressit.com/error#password") {
                    pin_attempts_left -= 1;
                    if (pin_attempts_left > 0) {
                        suffix = '; ' + gettext('%s attempts left.').replace('%s', pin_attempts_left);
                    } else {
                        suffix = '; ' + gettext('0 attempts left - PIN removed.').replace('%s', pin_attempts_left);
                        storage.remove(storage_keys.PIN_ID+storage_suffix);
                        storage.remove(storage_keys.PIN_CHAINCODE+storage_suffix);
                        storage.remove(storage_keys.ENCRYPTED_SEED+storage_suffix);
                        state.has_pin = false;
                        state.toggleshowpin = true;
                        delete use_pin_data.pin;
                    }
                }
                notices.makeNotice('error', (e.args[1] || e) + suffix);
                state.login_error = true;
            });
    }
}]);
