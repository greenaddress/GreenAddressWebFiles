var allHwWallets = require('wallet').GA.allHwWallets;
var BaseHWWallet = require('wallet').GA.BaseHWWallet;
var signup = {};
var secured_confirmed;

module.exports = [
    '$scope',
    '$location',
    'mnemonics',
    'focus',
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

function SignupController($scope, $location, mnemonics, focus, tx_sender, notices, wallets, $window, $uibModal, gaEvent, $q, storage, bip38, $interval, $sce, hw_wallets, user_agent) {
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
    var requires_mnemonic = ($location.path() == '/signup_pin' || $location.path() == '/signup_2factor');
    if (requires_mnemonic && !signup.mnemonic && !signup.hw_detected) {
        $location.path('/create');
        return;
    }
    var refresh = $location.path() === '/create_refresh';
    var first_page = false;
    if (!$scope.wallet.signup || refresh) {  // clear for case of other signup done previously in the same browser/crx session
        if (signup.hw_detected) {
            // reset hw wallets state for the case of 'refresh' clicked in
            // the hw wallets flow
            allHwWallets.forEach(function (hw) {
                try {
                    hw.disconnectCurrentDevice();
                } catch (e) { }
            });
            BaseHWWallet.allowAnotherCheck();
        }
        first_page = true;
        for (var k in signup) {
            signup[k] = undefined;
        }
    }
    $scope.signup = signup;
    if (refresh) {
        $location.path('/create');
    }
    if (!signup.empty_mytrezor_message) {
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
    }
    if ($location.path() == '/trezor_signup') {
        signup.is_trezor = true;
        signup.seed_progress = 100;
    } else if ($location.path() == '/create') {
        signup.is_trezor = false;
    }

    if ($location.path() == '/signup_2factor' && !$scope.signup.hw_detected) {
        wallets.verify_mnemonic($scope, {signup: true}).catch(function(e) {
            $location.url('/create#content_container');
        });
    }
    if($location.path() === '/signup_pin'){
        focus('pin');
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
                            if (!$scope.signup.hw_detected) {
                              $scope.wallet.mnemonic = $scope.signup.mnemonic = mnemonic
                            }
                            secured_confirmed.promise.then(function() {
                                hdwallet.seed_hex = seed;
                                if ($scope.wallet.mnemonic) {
                                    // no hardware wallet because user confirmed they backed up their seed:
                                    $scope.wallet.nohw_chosen = true;
                                    var hdPromise = $q.when({
                                        master_public: hdwallet.keyPair.getPublicKeyBuffer().toString('hex'),
                                        master_chaincode: hdwallet.chainCode.toString('hex')
                                    });
                                } else {
                                    // hw wallet
                                    var hdDeferred = $q.defer(), hdPromise = hdDeferred.promise;
                                    signup_with_hw(hdDeferred);
                                }

                                var loginWalletOptions, walletPromise;
                                if (hwDevice) {
                                    loginWalletOptions = {
                                        signup: true
                                    };
                                    walletPromise = wallets.walletFromHW(
                                        $scope, hwDevice, loginWalletOptions
                                    );
                                } else {
                                    loginWalletOptions = {
                                        mnemonic: mnemonic,
                                        seed: new Bitcoin.Buffer.Buffer(seed, 'hex'),
                                        pathSeed: new Bitcoin.Buffer.Buffer(path_seed, 'hex'),
                                        signup: true
                                    };
                                    walletPromise = $q.when(
                                        wallets.walletFromHD(
                                            $scope, hdwallet, loginWalletOptions
                                        )
                                    );
                                }
                                var pathPromise = walletPromise.then(function (wallet) {
                                    return wallet.signingWallet.derivePath();
                                });
                                hdPromise = $q.all([hdPromise, walletPromise, pathPromise]);
                                hdPromise.then(function(args) {
                                    var hd = args[0];
                                    var wallet = args[1];
                                    var pathHex = args[2].toString('hex');
                                    tx_sender.call('com.greenaddress.login.register',
                                          hd.master_public, hd.master_chaincode,
                                          '[v2,sw]'+user_agent($scope.wallet),
                                          pathHex
                                    ).then(function (data) {
                                        wallets.newLogin(
                                            $scope, wallet, loginWalletOptions
                                        ).then(function(data) {
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
                    if (!$scope.signup.hw_detected) {
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
        var next_page = '/receive';
        if (!$scope.signup.pin) {
            gaEvent('Signup', 'PinSkippedToWallet');
            $location.url(next_page);
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

    $scope.signup.qrmodal = function() {
        gaEvent('Signup', 'QrModal');
        $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signup_qr_modal.html',
            scope: $scope
        });
    };

    var hwDevice;

    if (first_page) {
        // automatically trigger the HW wallet setup when device is detected:
        hw_wallets.checkDevices(tx_sender.gaService.netName).then(function (hwDevice_) {
            if (secured_confirmed_resolved) {
                return;  // already confirmed the sw mnemonic
            }
            hwDevice = hwDevice_;
            hwDevice.getPublicKey().then(function () {
                $rootScope.safeApply(function () {
                    delete $scope.wallet.mnemonic;
                    signup.hw_detected = true;
                });
            }).catch(function (e) {
                $rootScope.safeApply(function () {
                    $scope.signup.hw_detected = true;
                    $scope.signup.empty_trezor = true;
                    if (hwDevice.deviceTypeName !== 'TREZOR') {
                        signup.empty_mytrezor_message = $sce.trustAsHtml(gettext(
                            'Empty %s hardware wallet detected. Please initialize it before using with GreenAddress.'
                        ).replace('%s', hwDevice.deviceTypeName));
                    }
                    delete $scope.wallet.mnemonic;
                });
            });
        }, function (err) {
            notices.makeNotice('error', err.message);
        });
    }

}
