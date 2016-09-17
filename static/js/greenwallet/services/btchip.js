var angular = require('angular');
var window = require('global/window');

var BaseHWWallet = require('wallet').GA.BaseHWWallet;
var cordova = window.cordova;
var ByteString = window.ByteString;
var Bitcoin = window.Bitcoin;
var gettext = window.gettext;
var HEX = window.HEX;
var ASCII = window.ASCII;
var BASE_URL = window.BASE_URL;
var LANG = window.LANG;
var Q = require('q');

module.exports = factory;

factory.dependencies = ['$q', '$interval', '$uibModal', '$rootScope', 'mnemonics', 'notices', 'focus', 'cordovaReady', '$injector'];

function factory ($q, $interval, $uibModal, $rootScope, mnemonics, notices, focus, cordovaReady, $injector) {
  BaseHWWallet.registerGUICallback('ledgerSetupModal', showSetupModal);
  BaseHWWallet.registerGUICallback('ledgerPINPrompt', showPINPrompt);

  function showSetupModal (options) {
    // show a modal asking the user to either setup a HW device, or reset/reuse
    // it if it's already set up. return an object (modal) allowing closing the
    // modal with close() method.
    var scope = $rootScope.$new();
    scope.btchip = {
      already_setup: options.alreadySetup,
      gait_setup: false,
      use_gait_mnemonic: options.usingMnemonic,
      storing: false,
      replug_required: false,
      reset: function () {
        this.resets_remaining = 3;
        this.resetting = true;
        this.replug_required = true;
        options.reset();
      },
      store: function () {
        options.finalize();
      }
    };
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_btchip_setup.html',
      scope: scope
    });
    modal.result.catch(function () { options.cancel(); });
    modal.attempt = function (num, replug_required) {
      $rootScope.safeApply(function () {
        scope.btchip.resets_remaining = num;
        scope.btchip.replug_required = replug_required;
        scope.btchip.resetting = replug_required;
        scope.btchip.already_setup = replug_required;
      });
    };
    modal.replugForBackup = function () {
      $rootScope.safeApply(function () {
        scope.btchip.gait_setup = true;
        scope.btchip.replug_for_backup = true;
      });
    };
    return modal;
  }

  function showPINPrompt (callback) {
    pinModalCallbacks.push({cb: callback, devnum: devnum});
    if (pinModalCallbacks.length > 1) return; // modal already displayed
    var scope, modal;

    scope = angular.extend($rootScope.$new(), {
      pin: '',
      pinNotCancelable: pinNotCancelable
    });
    pinNotCancelable = false;

    modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_btchip_pin.html',
      size: 'sm',
      windowClass: 'pinmodal',
      backdrop: 'static',
      keyboard: false,
      scope: scope
    });

    focus('btchipPinModal');

    return modal.result.then(
      function (res) {
        var oldCallbacks = pinModalCallbacks.slice();
        var d = $q.when();
        for (var i = 0; i < oldCallbacks.length; i++) {
          if (oldCallbacks[i].devnum === devnum) {
            d = queueCallback(i);
          }
        }
        pinModalCallbacks = [];
        return d;

        function queueCallback (i) {
          return d.then(function () {
            return oldCallbacks[i].cb(null, res);
          });
        }
      },
      function (err) {
        var oldCallbacks = pinModalCallbacks.slice();
        for (var i = 0; i < oldCallbacks.length; i++) {
          oldCallbacks[i].cb(err);
        }
        pinModalCallbacks = [];
      }
    );
  }

  /* *@TODO
      This should be broken into 2 services
      1 service should monitor and event based on the state of hardware wallets
      and expose an API for interacting with them
      a second service should manage UI events based on the behavior of these
      wallets. This isolation will make HW wallets easier to support and the
      UI's related to them easier to maintain... it will also allow us to
      cleave off any reusable code for HW wallets we want to publish into the
      ecosystem

      This will require a refactor since currently the business logic and UI
      control flow are bound directly to each other
  */
  var cardFactory;
  var cardFactoryBootloader;
  if (window.ChromeapiPlugupCardTerminalFactory) {
    cardFactory = new window.ChromeapiPlugupCardTerminalFactory();
    cardFactoryBootloader = new window.ChromeapiPlugupCardTerminalFactory(0x1808);
  }

  var BTChipCordovaWrapper = function () {
    var dongle = {
      disconnect_async: function () {
        var d = $q.defer();
        cordova.exec(function () {
          d.resolve();
        }, function (fail) {
          d.reject(fail);
        }, 'BTChip', 'disconnect', []);
        return d.promise;
      }
    };
    return {
      app: {
        callQueue: [],
        makeFirstCall: function () {
          var next = function () {
            this.callQueue.shift();
            if (this.callQueue.length) {
              this.makeFirstCall();
            }
          }.bind(this);
          var call = this.callQueue[0];
          cordova.exec(function (result) {
            call[0](result);
            next();
          }, function (fail) {
            call[1](fail);
            next();
          }, 'BTChip', call[2], call[3]);
        },
        queuedCordovaCall: function (cb, eb, func, args) {
          this.callQueue.push([cb, eb, func, args]);
          if (this.callQueue.length === 1) {
            this.makeFirstCall();
          }
        },
        getFirmwareVersion_async: function () {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            result = new ByteString(result, HEX);
            d.resolve({
              compressedPublicKeys: result.byteAt(0) === 0x01,
              firmwareVersion: result.bytes(1)
            });
          }, function (fail) {
            d.reject(fail);
          }, 'getFirmwareVersion', []);
          return d.promise;
        },
        verifyPin_async: function (pin) {
          if (this.pin_verified) return $q.when();
          var that = this;
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            that.pin_verified = true;
            d.resolve();
          }, function (fail) {
            d.reject(fail);
          }, 'verifyPin', [pin.toString(HEX)]);
          return d.promise;
        },
        getWalletPublicKey_async: function (path) {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            d.resolve({
              bitcoinAddress: {value: result.bitcoinAddress},
              chainCode: new ByteString(result.chainCode, HEX),
              publicKey: new ByteString(result.publicKey, HEX)
            });
          }, function (fail) {
            d.reject(fail);
          }, 'getWalletPublicKey', [path]);
          return d.promise;
        },
        signMessagePrepare_async: function (path, msg) {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            d.resolve(result);
          }, function (fail) {
            d.reject(fail);
          }, 'signMessagePrepare', [path, msg.toString(HEX)]);
          return d.promise;
        },
        signMessageSign_async: function (pin) {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            d.resolve(new ByteString(result, HEX));
          }, function (fail) {
            d.reject(fail);
          }, 'signMessageSign', [pin.toString(HEX)]);
          return d.promise;
        },
        gaStartUntrustedHashTransactionInput_async: function (newTransaction, tx, i) {
          var d = Q.defer();
          var inputs = [];
          for (var j = 0; j < tx.ins.length; j++) {
            var input = tx.ins[j];
            var txhash = input.hash.toString('hex');
            var outpointAndSequence = new Bitcoin.Buffer.Buffer(8);
            outpointAndSequence.writeUInt32LE(input.index, 0);
            outpointAndSequence.writeUInt32LE(input.sequence, 4);
            outpointAndSequence = outpointAndSequence.toString('hex');
            inputs.push(txhash + outpointAndSequence);
          }
          var script = tx.ins[i].script.toString('hex');
          this.queuedCordovaCall(function (result) {
            d.resolve(result);
          }, function (fail) {
            d.reject(fail);
          }, 'startUntrustedTransaction', [newTransaction, i, inputs, script]);
          return d.promise;
        },
        gaUntrustedHashTransactionInputFinalizeFull_async: function (tx) {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            d.resolve(result);
          }, function (fail) {
            d.reject(fail);
          }, 'finalizeInputFull', [tx.serializeOutputs().toString('hex')]);
          return d.promise;
        },
        signTransaction_async: function (path, transactionAuthorization, lockTime) {
          var d = Q.defer();
          this.queuedCordovaCall(function (result) {
            d.resolve(new ByteString(result, HEX));
          }, function (fail) {
            d.reject(fail);
          }, 'untrustedHashSign', [path, lockTime]);
          return d.promise;
        }
      },
      dongle: dongle
    };
  };
  var pinModalCallbacks = [];
  var pinNotCancelable = false;
  var devnum = 0;
  return {
    _setupWrappers: function (btchip) {
      // wrap some functions to allow using them even after disconnecting the dongle
      // (prompting user to reconnect and enter pin)
      var service = this;
      var WRAP_FUNCS = [
        'gaStartUntrustedHashTransactionInput_async',
        'signMessagePrepare_async'
      ];
      WRAP_FUNCS.map(function (func_name) {
        btchip[func_name] = function () {
          var deferred = $q.defer();
          var origArguments = arguments;
          var d;
          try {
            d = btchip.app[func_name].apply(btchip.app, arguments);
          } catch (e) {
            // handle `throw "Connection is not open"` gracefully - getDevice() below
            d = $q.reject();
          }
          d.then(function (data) {
            deferred.resolve(data);
          }, function (error) {
            if (!error || !error.indexOf || error.indexOf('Write failed') !== -1) {
              notices.makeNotice('error', gettext('BTChip communication failed'));
              // no btchip - try polling for it
              service.getDevice().then(function (btchip_) {
                btchip.app = btchip_.app;
                btchip.dongle = btchip_.dongle;
                deferred.resolve(btchip[func_name].apply(btchip, origArguments));
              });
            } else {
              if (error.indexOf('6982') >= 0) {
                btchip.app.pin_verified = false;
                // setMsg("Dongle is locked - enter the PIN")
                return service.promptPin('', function (err, pin) {
                  if (err || !pin) {
                    deferred.reject(err);
                    return;
                  }
                  return btchip.app.verifyPin_async(new ByteString(pin, ASCII)).then(function () {
                    var d = $q.defer(); // don't call two functions at once in pinModalCallbacks
                    btchip[func_name].apply(btchip, origArguments).then(function (ret) {
                      deferred.resolve();
                      d.resolve(ret);
                    });
                    return d.promise;
                  }).fail(function (error) {
                    btchip.dongle.disconnect_async();
                    if (error.indexOf('6982') >= 0) {
                      notices.makeNotice('error', gettext('Invalid PIN'));
                    } else if (error.indexOf('6985') >= 0) {
                      notices.makeNotice('error', gettext('Dongle is not set up'));
                    } else if (error.indexOf('6faa') >= 0) {
                      notices.makeNotice('error', gettext('Dongle is locked - reconnect the dongle and retry'));
                    } else {
                      notices.makeNotice('error', error);
                    }
                    deferred.reject();
                  });
                });
              } else if (error.indexOf('6985') >= 0) {
                notices.makeMessage('error', gettext('Dongle is not set up'));
                deferred.reject();
              } else if (error.indexOf('6faa') >= 0) {
                notices.makeMessage('error', gettext('Dongle is locked - remove the dongle and retry'));
                deferred.reject();
              }
            }
          });
          return deferred.promise;
        };
      });
      return btchip;
    },
    getDevice: function (noModal, modalNotDisableable, existing_device) {
      var service = this;
      var deferred = $q.defer();

      if (window.cordova && cordova.platformId === 'ios') return deferred.promise;
      if (!cardFactory && !window.cordova) return $q.reject();

      var modal;
      function showModal () {
        if (!noModal && !modal) {
          $rootScope.safeApply(function () {
            var options = {
              templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_usb_device.html'
            };
            if (modalNotDisableable) {
              options.scope = angular.extend($rootScope.$new(), {
                notCancelable: true
              });
              options.backdrop = 'static';
              pinNotCancelable = true;
            }
            modal = $uibModal.open(options);
            $injector.get('hw_detector').modal = modal;
            modal.result.finally(function () {
              $interval.cancel(tick);
            });
          });
        }
        if (noModal) {
          if (noModal === 'retry') return;
          $interval.cancel(tick);
          deferred.reject();
        }
      }

      var check = cordovaReady(function () {
        var existing_promise;
        if (existing_device) {
          existing_promise = existing_device.app.getFirmwareVersion_async();
        } else {
          existing_promise = $q.reject();
        }
        window.existing_promise = existing_promise;

        existing_promise.then(function () {
          $interval.cancel(tick);
          deferred.resolve(existing_device);
        }, function () {
          var app_promise;
          if (window.cordova) {
            var app_d = $q.defer();
            app_promise = app_d.promise;
            cordova.exec(function (result) {
              if (result) {
                var wrapper = new BTChipCordovaWrapper();
                app_d.resolve({app: wrapper.app, dongle: wrapper.dongle});
              } else showModal();
            }, function (fail) {}, 'BTChip', 'has_dongle', []);
          } else {
            app_promise = cardFactory.list_async().then(function (result) {
              if (result.length) {
                return cardFactory.getCardTerminal(result[0]).getCard_async().then(function (dongle) {
                  devnum += 1;
                  return {app: new window.BTChip(dongle), dongle: dongle, devnum: devnum};
                });
              } else {
                cardFactoryBootloader.list_async().then(function (result) {
                  if (result.length) {
                    showUpgradeModal();
                    $interval.cancel(tick);
                  } else {
                    showModal();
                  }
                });
              }
            });
          }
          app_promise.then(function (btchip) {
            if (!btchip) { return; }
            btchip.app.getFirmwareVersion_async().then(function (version) {
              if (noModal) {
                $interval.cancel(tick);
              } else if (modal) {
                modal.close(); // modal close cancels the tick
              } else {
                $interval.cancel(tick);
              }
              var features = {};
              var firmwareVersion = version.firmwareVersion.bytes(0, 4);
              if (firmwareVersion.toString(HEX) < '00010408') {
                btchip.dongle.disconnect_async();
                showUpgradeModal();
                return;
              }
              features.signMessageRecoveryParam =
                firmwareVersion.toString(HEX) >= '00010409';
              features.quickerVersion =
                firmwareVersion.toString(HEX) >= '0001040b';
              deferred.resolve(service._setupWrappers({dongle: btchip.dongle,
                app: btchip.app,
              features: features}));
            });
          });
        });
      });
      var tick = $interval(check, 1000);
      check();

      return deferred.promise;

      function showUpgradeModal () {
        var notice = gettext('Old BTChip firmware version detected. Please upgrade to at least %s.').replace('%s', '1.4.8');
        if (window.cordova) {
          notices.makeNotice('error', notice);
        } else {
          var scope = angular.extend($rootScope.$new(), {
            firmware_upgrade_message: notice
          });
          $uibModal.open({
            templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_btchip_fup.html',
            scope: scope
          }).result.then(function () {
            deferred.resolve(service.getDevice(noModal, modalNotDisableable, existing_device));
          });
        }
      }
    }
  };
}
