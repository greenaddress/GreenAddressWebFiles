var signup = {};
var secured_confirmed;

module.exports = [
    '$scope',
    '$location',
    'mnemonics',
    'tx_sender',
    'notices',
    'wallets',
    '$window',
    '$uibModal',
    'gaEvent',
    '$q',
    'storage',
    'bip38',
    '$interval',
    '$sce',
    'hw_wallets',
    'user_agent',
    SignupController
];

function SignupController($scope, $location, mnemonics, tx_sender, notices, wallets, $window, $uibModal, gaEvent, $q, storage, bip38, $interval, $sce, hw_wallets, user_agent) {
    // some Android devices have window.WebSocket defined and yet still don't support WebSockets
    var isUnsupportedAndroid = navigator.userAgent.match(/Android 4.0/i) ||
                               navigator.userAgent.match(/Android 4.1/i) ||
                               navigator.userAgent.match(/Android 4.2/i) ||
                               navigator.userAgent.match(/Android 4.3/i);
    var isIE = navigator.userAgent.match(/MSIE/i) || navigator.userAgent.match(/Trident/i);
    var isChrome = navigator.userAgent.match(/Chrome/i);
    var is_chrome_app = window.chrome && chrome.storage;
    if (!window.cordova && (isIE || !window.crypto || !window.WebSocket || !window.Worker || (isUnsupportedAndroid && !isChrome))) {
        $location.path('/browser_unsupported');
        return;
    }
    var requires_mnemonic = ($location.path() == '/signup_pin' || $location.path() == '/signup_oauth' || $location.path() == '/signup_2factor');
    if (requires_mnemonic && !signup.mnemonic && !tx_sender.trezor_dev) {
        $location.path('/create');
        return;
    }
    var first_page = false;
    if (!$scope.wallet.signup) {  // clear for case of other signup done previously in the same browser/crx session
        first_page = true;
        for (var k in signup) {
            signup[k] = undefined;
        }
    }
    $scope.signup = signup;
    signup.empty_mytrezor_message = gettext('Please go to %s first to set up your device.');
    if (is_chrome_app) {
        signup.empty_mytrezor_message = $sce.trustAsHtml(signup.empty_mytrezor_message.replace(
            '%s',
            '<a href="https://mytrezor.com/" target="_blank">myTREZOR</a>'));
    } else {
        // don't use target _blank for browser because the signup page needs refreshing
        // after TREZOR setup anyway
        signup.empty_mytrezor_message = $sce.trustAsHtml(signup.empty_mytrezor_message.replace(
            '%s',
            '<a href="https://mytrezor.com/">myTREZOR</a>'));
    }
    if ($location.path() == '/trezor_signup') {
        signup.is_trezor = true;
        signup.seed_progress = 100;
    } else if ($location.path() == '/create') {
        signup.is_trezor = false;
    }
    signup.noLocalStorage = storage.noLocalStorage;
    $scope.wallet.hidden = true;
    $scope.wallet.signup = true;

    var signup_with_hw = function(hd_deferred) {
        hwDevice.getPublicKey().then(function(result) {
            var hdwallet = result.hdnode;
            hd_deferred.resolve({
                master_public: hdwallet.keyPair.getPublicKeyBuffer().toString('hex'),
                master_chaincode: hdwallet.chainCode.toString('hex')
            })
        })
    }

    if (signup.customloginstate === undefined) {
        secured_confirmed = $q.defer();
        signup.customloginstate = {};
        if (!signup.is_trezor)
            signup.seed_progress = 0;
        var entropy, hdwallet;

        var generate_mnemonic = function() {
            $scope.signup.unexpected_error = false;
            entropy = Bitcoin.randombytes(32);
            while (entropy.length < 32) entropy.unshift(0);
            $scope.signup.seed = new Bitcoin.Buffer.Buffer(entropy, 'hex');
            mnemonics.toMnemonic(entropy).then(function(mnemonic) {
                mnemonics.toSeed(mnemonic).then(function(seed) {
                    mnemonics.toSeed(mnemonic, 'greenaddress_path').then(function(path_seed) {
                        $q.when(Bitcoin.bitcoin.HDNode.fromSeedHex(seed, cur_net)).then(function(hdwallet) {
                            secured_confirmed.promise.then(function() {
                                hdwallet.seed_hex = seed;
                                if ($scope.wallet.mnemonic) {
                                    // no hardware wallet because user confirmed they backed up their seed:
                                    $scope.wallet.nohw_chosen = true;
                                    var hd_promise = $q.when({
                                        master_public: hdwallet.keyPair.getPublicKeyBuffer().toString('hex'),
                                        master_chaincode: hdwallet.chainCode.toString('hex')
                                    });
                                } else {
                                    // hw wallet
                                    var hd_deferred = $q.defer(), hd_promise = hd_deferred.promise;
                                    signup_with_hw(hd_deferred);
                                }
                                hd_promise.then(function(hd) {
                                    tx_sender.call('com.greenaddress.login.register',
                                            hd.master_public, hd.master_chaincode,
                                            user_agent($scope.wallet)).then(function(data) {
                                        if (hwDevice) {
                                            var login_d = wallets.loginWithHWWallet(
                                                $scope, hwDevice, {
                                                    signup: true
                                                }
                                            );
                                        } else {
                                            var login_d = wallets.loginWithHDWallet(
                                                $scope, hdwallet, {
                                                    mnemonic: mnemonic,
                                                    seed: new Bitcoin.Buffer.Buffer(seed, 'hex'),
                                                    pathSeed: new Bitcoin.Buffer.Buffer(path_seed, 'hex'),
                                                    signup: true
                                                }
                                            )
                                        }
                                        login_d.then(function(data) {
                                            gaEvent('Signup', 'LoggedIn');
                                            $scope.signup.logged_in = data;
                                            if (!data) $scope.signup.login_failed = true;
                                            if (data && !data.first_login) {
                                                notices.makeNotice('success', gettext('You were already registered, so we logged you in.'));
                                                $location.path('/info');
                                            }
                                        });
                                    });
                                });
                            });
                        });
                    }, null, function(progress) {
                        $scope.signup.seed_progress = Math.round(50 + progress/2);
                    });
                }, function(err) {
                    $scope.signup.unexpected_error = err;
                }, function(progress) {
                    // any progress means the mnemonic is valid so we can display it
                    if (!($scope.signup.trezor_detected || $scope.has_btchip)) {
                        $scope.wallet.mnemonic = $scope.signup.mnemonic = mnemonic;
                        $scope.signup.seed_progress = Math.round(progress/2);
                    }
                });
            }, function(err) {
                $scope.signup.unexpected_error = err.status || err;
            });
        };

        generate_mnemonic();
    }

    $scope.signup.try_again = function() {
        // should not ever happen, but just in case we have another bug
        generate_mnemonic();
    };

    var secured_confirmed_resolved = false;
    $scope.$watch('signup.secured_confirmed', function(newValue, oldValue) {
        if (newValue == oldValue) return;
        if (newValue && !secured_confirmed_resolved) {
            if (window.disableEuCookieComplianceBanner) {
                disableEuCookieComplianceBanner();
            }
            secured_confirmed.resolve(true);
            secured_confirmed_resolved = true;
        }
    });

    $scope.signup.set_pin = function() {
        var next_page = '/signup_oauth';
        if (!$scope.signup.pin) {
            gaEvent('Signup', 'PinSkippedToOauth');
            $location.url(next_page + '#content_container');
            return;
        }
        $scope.signup.setting_pin = true;
        wallets.create_pin($scope.signup.pin.toString(), $scope).then(function() {
            gaEvent('Signup', 'PinSet');
            $scope.signup.pin_set = true;
            $scope.signup.setting_pin = false;
            $location.url(next_page);
        }, function(failure) {
            gaEvent('Signup', 'PinSettingFailed', failure);
            notices.makeNotice('error', 'Failed setting PIN.' + (failure ? ' ' + failure : ''));
            $scope.signup.setting_pin = false;
        });

    };

    $scope.signup.customlogin = function() {
        gaEvent('Signup', 'CustomLoginClicked');
        $scope.got_username_password = function(username, password) {
            tx_sender.call('com.greenaddress.addressbook.sync_custom', username, password).then(function() {
                gaEvent('Signup', 'CustomLoginEnabled');
                notices.makeNotice('success', gettext('Custom login enabled'));
                $scope.signup.any_social_done = true;
                $scope.signup.customloginstate.synchronized = true;
                modal.close();
            }, function(err) {
                gaEvent('Signup', 'CustomLoginEnableFailed', err.args[1]);
                notices.makeNotice('error', err.args[1]);
            });
        };
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_custom_login.html',
            scope: $scope
        });
    }

    $scope.signup.qrmodal = function() {
        gaEvent('Signup', 'QrModal');
        $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signup_qr_modal.html',
            scope: $scope
        });
    };

    $scope.signup.nfcmodal = function() {
        gaEvent('Signup', 'NfcModal');
        var mnemonic, mime;
        if ($scope.signup.mnemonic_encrypted) {
            mnemonic = $scope.signup.mnemonic_encrypted;
            mime = 'x-ga/en';
        } else {
            mnemonic = $scope.wallet.mnemonic;
            mime = 'x-gait/mnc';
        }
        mnemonics.validateMnemonic(mnemonic).then(function(bytes) {
            $scope.nfc_bytes = bytes;
            $scope.nfc_mime = mime;
            $uibModal.open({
                templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signup_nfc_modal.html',
                scope: $scope,
                controller: 'NFCController'
            });
        });
    };

    $scope.signup.encrypt_mnemonic = function() {
        gaEvent('Signup', 'EncryptMnemonic');
        bip38.encrypt_mnemonic_modal($scope, new Bitcoin.Buffer.Buffer($scope.signup.seed, 'hex')).then(function(encrypted) {
            $scope.signup.mnemonic_encrypted = encrypted;
        });
    };

    $scope.signup.usbmodal = function() {
        var that = this;
        that.hw_wallet_processing = true;
        btchip.getDevice().then(function () {
            btchip.setupSeed($scope.wallet.mnemonic).then(function () {
                $scope.signup.has_btchip = true;
            });
        }).finally(function () {
            that.hw_wallet_processing = false;
        })
    }

    var hwDevice;

    $scope.signup.usb_hwseed_modal = function() {
        if (!is_chrome_app) { hw_detector.showModal(); return; }
        var that = this;
        that.hw_wallet_processing = true;
        hw_wallets.waitForHwWallet(cur_net).then(function (hwDevice_) {
            if (hwDevice_.deviceTypeName === 'TREZOR') {
                $scope.$apply(function () {
                    that.hw_wallet_processing = false;
                });
                // special flow handled below
                return;
            }
            hwDevice = hwDevice_;
            return hwDevice.setupSeed().then(function(result) {
                delete $scope.wallet.mnemonic;
                $scope.signup.mnemonic = gettext('Mnemonic not available when using hardware wallet seed');

                $scope.signup.has_btchip = true;
                $scope.signup.btchip_pin = result.pin;
            });
        }).finally(function() { that.hw_wallet_processing = false; })
    }

    if (first_page) {
        hw_wallets.checkDevices(cur_net).then(function (hwDevice_) {
            if (secured_confirmed_resolved || hwDevice_.deviceTypeName !== 'TREZOR') return;
            // if (hw_detector.modal) {
            //     hw_detector.success = true;
            //     hw_detector.modal.close();
            // }
            hwDevice = hwDevice_;
            hwDevice.getPublicKey().then(function () {
                $scope.$apply(function () {
                    $scope.signup.has_trezor = true;;
                    delete $scope.wallet.mnemonic;
                    $scope.signup.trezor_detected = true;
                });
            }).catch(function (e) {
                if (e.code === "Failure_NotInitialized") {
                    $scope.$apply(function () {
                        $scope.signup.empty_trezor = true;;
                        delete $scope.wallet.mnemonic;
                        $scope.signup.trezor_detected = true;
                    });
                } else {
                    notices.makeNotice('error', e);
                }
            });
        });
    }

}
