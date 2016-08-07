var window = require('global/window');
var document = require('global/document');

var Electrum = window.Electrum;
var gettext = window.gettext;
var autobahn = window.autobahn;
var wss_url = window.wss_url;
var dev_d = window.dev_d;
var Bitcoin = window.Bitcoin;
var ByteString = window.ByteString;
var HEX = window.HEX;

var GAAssetsWallet = require('wallet').GA.AssetsWallet;
var GAWallet = require('wallet').GA.GAWallet;

module.exports = factory;

factory.dependencies = ['$q',
  '$rootScope',
  'cordovaReady',
  '$http',
  'notices',
  'gaEvent',
  '$location',
  'autotimeout',
  'device_id',
  'btchip',
  'mnemonics',
  'storage'
];

function factory ($q, $rootScope, cordovaReady, $http, notices, gaEvent, $location, autotimeout, device_id, btchip, mnemonics, storage) {
  var txSenderService = {
    waitForConnection: waitForConnection,
    call: call,
    logged_in: false,
    login: login,
    logout: logout,
    loginWatchOnly: loginWatchOnly,
    change_pin: change_pin
  };
  // disable electrum setup
  if (false && window.Electrum) {
    if (window.cordova) {
      txSenderService.electrum = new Electrum($http, $q);
    } else {
      txSenderService.electrum = new Electrum();
      txSenderService.electrum.connectToServer();
    }
  }
  var connection;
  var session;
  var session_for_login;
  var calls = [];
  var calls_missed = {};
  var calls_counter = 0;
  var global_login_d;
  var isMobile = /Android|iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent);
  var attempt_login = false;
  var disconnected = false;
  var connecting = false;
  var nconn = 0;
  var waiting_for_device = false;

  if (window.cordova) {
    cordovaReady(function () {
      document.addEventListener('resume', function () {
        if (!txSenderService.wallet || !txSenderService.logged_in) return;
        if (session || session_for_login) {
          connection.close(); // reconnect on resume
        }
        session = session_for_login = null;
        txSenderService.gawallet = null;
        disconnected = true;
        txSenderService.wallet.update_balance();
      }, false);
    })();
  } else if (isMobile && typeof document.addEventListener !== undefined) {
    // reconnect on tab shown in mobile browsers
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && txSenderService.wallet && txSenderService.logged_in) {
        txSenderService.wallet.update_balance();
      }
    }, false);
  }

  cordovaReady(connect)();

  return txSenderService;

  function onLogin (data) {
    var s = session || session_for_login;
    s.subscribe('com.greenaddress.txs.wallet_' + data.receiving_id,
      function (event) {
        gaEvent('Wallet', 'TransactionNotification');
        $rootScope.$broadcast('transaction', event[0]);
      });
    s.subscribe('com.greenaddress.fee_estimates',
      function (event) {
        $rootScope.$broadcast('fee_estimate', event[0]);
      });
  }
  function waitForConnection () {
    if (session) {
      return $q.when();
    } else {
      if (disconnected) {
        disconnected = false;
        connect(global_login_d);
      }
      var d = $q.defer();
      calls.push([null, d]);
      return d.promise;
    }
  }
  function call () {
    var d = $q.defer();
    if (session) {
      var cur_call = calls_counter++;
      calls_missed[cur_call] = [arguments, d]; // will be called on new session
      try {
        var uri = arguments[0].replace('http://greenaddressit.com/', 'com.greenaddress.').replace('/', '.');
        session.call(uri, Array.prototype.slice.call(arguments, 1)).then(function (data) {
          if (!calls_missed[cur_call]) {
            // avoid resolving the same call twice
            return;
          }
          delete calls_missed[cur_call];
          d.resolve(data);
        }, function (err) {
          if (err.args[0] === 'http://greenaddressit.com/error#internal' && err.args[1] === 'Authentication required') {
            return; // keep in missed calls queue for after login
          }
          if (err.args[0] === 'http://greenaddressit.com/error#sessionexpired') {
            d.reject({
              args: [
                err.args[0],
                gettext('Session expired. Please try again.')
              ]
            });
            connection.close();
            connection = session = session_for_login = null;
            txSenderService.gawallet = null;
            connecting = false;
            connect(global_login_d);
            return;
          }
          if (!calls_missed[cur_call]) return; // avoid resolving the same call twice
          delete calls_missed[cur_call];
          d.reject(err);
        });
        var args = arguments;
        var timeout;
        if (args[0] === 'com.greenaddress.vault.prepare_sweep_social') timeout = 40000;
        else timeout = 10000;
        setTimeout(function () {
          delete calls_missed[cur_call];
          $rootScope.safeApply(function () {
            d.reject({desc: gettext('Request timed out (%s)')
                .replace('%s', args[0].split('/').slice(3).join('/'))
            });
          });
        }, timeout);
      } catch (e) {
        // if (!calls_missed[cur_call]) return  // avoid resolving the same call twice
        delete calls_missed[cur_call];
        d.reject(gettext('Problem with connection detected. Please try again.'));
      }
    } else {
      if (disconnected) {
        disconnected = false;
        connect(global_login_d);
      }
      calls.push([arguments, d]);
    }
    return d.promise;
  }
  function onAuthed (s, login_d) {
    session_for_login = s;
    session_for_login.subscribe('com.greenaddress.blocks', function (event) {
      $rootScope.$broadcast('block', event[0]);
    });
    var d;
    var logging_in = false;
    if (txSenderService.hdwallet && (txSenderService.logged_in || attempt_login)) {
      d = txSenderService.login('if_same_device', true); // logout=if_same_device, force_relogin
      logging_in = true;
    } else if (txSenderService.watch_only) {
      d = txSenderService.loginWatchOnly(txSenderService.watch_only[0], txSenderService.watch_only[1]);
      logging_in = true;
    } else {
      d = $q.when(true);
    }
    d.catch(function (err) {
      if (err.uri === 'http://greenaddressit.com/error#doublelogin') {
        if (login_d) {
          // login_d handler may want to handle double login by forcing logout
          login_d.reject(err);
          return;
        }
        autotimeout.stop();
        if (txSenderService.wallet) txSenderService.wallet.clear();
        $location.path('/concurrent_login');
      } else {
        console.log(err);
        notices.makeNotice('error', gettext('An error has occured which forced us to log you out.'));
        if (txSenderService.wallet) txSenderService.wallet.clear();
        $location.path('/');
      }
    });
    d.then(function (result) {
      session = session_for_login;
      if (logging_in && login_d) {
        login_d.resolve(result);
      }
      var i;
      var item;
      // warning: Never made the following code async without a rewrite or it'll break
      // object refs and stuff

      // missed calls queues
      for (i in calls_missed) {
        item = calls_missed[i];
        delete calls_missed[i];
        item[1].resolve(txSenderService.call.apply(session, item[0]));
      }
      while (calls.length) {
        item = calls.shift();
        if (item[0]) {
          item[1].resolve(txSenderService.call.apply(session, item[0]));
        } else {
          // no call required, just the connection (the waitForConnection case)
          item[1].resolve();
        }
      }
    }, function (err) {
      // missed calls queue - reject them as well
      // safeApply because txSenderService.login might've called $apply already
      $rootScope.safeApply(function () {
        while (calls.length) {
          var item = calls.shift();
          item[1].reject(err);
        }
      });
    });
  }
  function connect (login_d) {
    global_login_d = login_d;
    if (connecting) return;
    connecting = true;
    nconn += 1;
    // var retries = 60
    // var everConnected = false

    doConnect(nconn);

    function doConnect (nc) {
      connection = new autobahn.Connection({
        url: wss_url,
        realm: 'realm1',
        use_deferred: $q.defer
      });
      connection.onclose = function () {
        session = session_for_login = null;
        txSenderService.gawallet = null;
        disconnected = true;
      };
      connection.onopen = function (s) {
        s.caller_disclose_me = true;
        // everConnected = true
        if (nc !== nconn) {
          // newer connection created - close the old one
          s.close();
          return;
        }
        s.nc = nc;
        connecting = false;
        global_login_d = undefined;
        onAuthed(s, login_d, nc);
      };
      connection.open();
    }
  }
  // @TODO: refactor indentation hell to be function
  function login (logout, force_relogin, user_agent, path_seed, path, mnemonic) {
    var d_main = $q.defer();
    var d;
    if (txSenderService.logged_in && !force_relogin) {
      d_main.resolve(txSenderService.logged_in);
    } else {
      var hdwallet = txSenderService.hdwallet;
      attempt_login = true;
      if (hdwallet.keyPair.d) {
        if (session_for_login) {
          session_for_login.call('com.greenaddress.login.get_challenge', [hdwallet.getAddress().toString()])
            .then(function (challenge) {
              var challenge_bytes = new Bitcoin.BigInteger(challenge).toBuffer();

              // generate random path to derive key from - avoids signing using the same key twice
              var random_path_hex = Bitcoin.BigInteger
                .fromBuffer(Bitcoin.randombytes(8))
                .toString(16);

              while (random_path_hex.length < 16) {
                random_path_hex = '0' + random_path_hex;
              }

              $q.when(hdwallet.subpath_for_login(random_path_hex)).then(function (subhd) {
                $q.when(subhd.keyPair.sign(challenge_bytes)).then(function (signature) {
                  d_main.resolve(device_id().then(function (devid) {
                    if (session_for_login && session_for_login.nc === nconn) {
                      signature = [signature.r.toString(), signature.s.toString()];
                      var args = [
                        signature,
                        logout || false,
                        random_path_hex,
                        devid,
                        user_agent
                      ];
                      return session_for_login.call('com.greenaddress.login.authenticate', args)
                        .then(function (data) {
                          if (data) {
                            txSenderService.logged_in = data;

                            var gaUserPath;
                            if (data.gait_path) {
                              gaUserPath = data.gait_path;
                            } else if (path) {
                              gaUserPath = path;
                            } else if (path_seed) {
                              gaUserPath = mnemonics.seedToPath(path_seed);
                            }

                            var WalletClass = window.cur_net.isAlphaMultiasset ? GAAssetsWallet : GAWallet;
                            txSenderService.gawallet = new WalletClass({
                              existingSession: {
                                session: session_for_login,
                                hdwallet: txSenderService.hdwallet,
                                mnemonic: mnemonic,
                                gaUserPath: gaUserPath,
                                loginData: data
                              },
                              unblindedCache: {
                                _key: function (txhash, pt_idx) {
                                  var rev = [].reverse.call(new Bitcoin.Buffer.Buffer(txhash));
                                  return (
                                  'unblinded_value_' + rev.toString('hex') +
                                  ':' + pt_idx
                                  );
                                },
                                getValue: function (txhash, pt_idx) {
                                  return storage.get(this._key(txhash, pt_idx)).then(function (val) {
                                    return +val; // convert to a number
                                  });
                                },
                                setValue: function (txhash, pt_idx, value) {
                                  return storage.set(
                                    this._key(txhash, pt_idx),
                                    value
                                  );
                                }
                              }
                            });

                            onLogin(data);
                            return data;
                          } else {
                            return $q.reject(gettext('Login failed'));
                          }
                        });
                    } else if (!connecting) {
                      disconnected = false;
                      d = $q.defer();
                      connect(d);
                      d_main.resolve(d.promise);
                    }
                  }));
                });
              });
            });
        } else if (!connecting) {
          disconnected = false;
          d = $q.defer();
          connect(d);
          d_main.resolve(d.promise);
        }
      } else { // trezor_dev || btchip
        if (waiting_for_device) return;
        var trezor_dev = txSenderService.trezor_dev;
        var btchip_dev = txSenderService.btchip;
        var hwDevice = txSenderService.hwDevice;
        var get_pubkey = function () {
          if (hwDevice) {
            return $q.when(txSenderService.hdwallet.keyPair.getAddress());
          } else if (trezor_dev) {
            return $q.when(txSenderService.trezor_address);
          } else {
            return $q.when(txSenderService.btchip_address);
          }
        };
        get_pubkey().then(function (addr) {
          if (session_for_login) {
            if (hwDevice) {
              dev_d = $q.when(dev_d);
            } else if (trezor_dev) {
              dev_d = $q.when(trezor_dev);
            } else {
              dev_d = btchip.getDevice(false, true,
                // FIXME not sure why it doesn't work with Cordova
                // ("suspend app, disconnect dongle, resume app, reconnect dongle" case fails)
                window.cordova ? null : btchip_dev)
                .then(function (btchip_dev_) {
                  txSenderService.btchip = btchip_dev = btchip_dev_;
                });
            }
            waiting_for_device = true;
            var challenge_arg_resolves_main = false;
            var getChallengeArguments = function () {
              if (hwDevice) {
                return hwDevice.getChallengeArguments();
              } else {
                return Promise.when(['com.greenaddress.login.get_trezor_challenge', addr, !trezor_dev]);
              }
            };
            dev_d = dev_d.then(function () {
              if (session_for_login) {
                return getChallengeArguments().then(function (args) {
                  return session_for_login.call(
                    args[0], args.slice(1)
                  );
                });
              } else if (!connecting) {
                waiting_for_device = false;
                disconnected = false;
                d = $q.defer();
                connect(d);
                challenge_arg_resolves_main = true;
                return d.promise;
              } else waiting_for_device = false;
            });
            d_main.resolve(dev_d.then(function (challenge) {
              if (challenge_arg_resolves_main) return challenge;
              if (!challenge) return $q.defer().promise; // never resolve

              var msg_plain = 'greenaddress.it      login ' + challenge;
              var msg = (new Bitcoin.Buffer.Buffer(
                msg_plain, 'utf8'
              )).toString('hex');
              // btchip requires 0xB11E to skip HID authentication
              // 0x4741 = 18241 = 256*G + A in ASCII
              var path = [0x4741b11e];

              if (hwDevice) {
                return hwDevice.signMessage(path, msg).then(function (res) {
                  return Promise.all([Promise.resolve(res), device_id()]);
                }).then(function (resAndId) {
                  var res = resAndId[0];
                  var devid = resAndId[1];
                  return session_for_login.call('com.greenaddress.login.authenticate', [
                    [res.r.toString(), res.s.toString(), res.i.toString()],
                    logout || false,
                    'GA',
                    devid
                  ]).then(function (data) {
                    if (data) {
                      txSenderService.logged_in = data;
                      onLogin(data);
                      return data;
                    } else { return $q.reject(gettext('Login failed')); }
                  });
                });
              } else if (trezor_dev) {
                trezor_dev.signing = true;
                return trezor_dev._typedCommonCall('SignMessage', 'MessageSignature',
                  {'message': msg, address_n: path})
                  .then(function (res) {
                    var sig = res.message.signature;
                    sig = sig.toHex ? sig.toHex() : sig;
                    var signature = Bitcoin.bitcoin.ECSignature.parseCompact(
                      new Bitcoin.Buffer.Buffer(sig, 'hex')
                    );
                    trezor_dev.signing = false;
                    return device_id().then(function (devid) {
                      return session_for_login.call('com.greenaddress.login.authenticate', [
                        [signature.signature.r.toString(), signature.signature.s.toString(), signature.i.toString()],
                        logout || false,
                        'GA',
                        devid
                      ]).then(function (data) {
                        if (data) {
                          txSenderService.logged_in = data;
                          onLogin(data);
                          return data;
                        } else { return $q.reject(gettext('Login failed')); }
                      });
                    });
                  }, function (err) {
                    trezor_dev.signing = false;
                    return $q.reject(err.message);
                  });
              } else {
                // var t0 = new Date()
                return $q.when(hdwallet.derive(path[0])).then(function (result_pk) {
                  return btchip_dev.signMessagePrepare_async(path.join('/'), new ByteString(msg, HEX)).then(function (result) {
                    return btchip_dev.app.signMessageSign_async(new ByteString('00', HEX)).then(function (result) {
                      waiting_for_device = false;
                      var signature = Bitcoin.bitcoin.ECSignature.fromDER(
                        new Bitcoin.Buffer.Buffer('30' + result.bytes(1).toString(HEX), 'hex')
                      );
                      var i;
                      if (btchip_dev.features.signMessageRecoveryParam) {
                        i = result.byteAt(0) & 0x01;
                      } else {
                        i = Bitcoin.ecdsa.calcPubKeyRecoveryParam(
                          Bitcoin.BigInteger.fromBuffer(Bitcoin.message.magicHash(msg_plain)),
                          {r: signature.r, s: signature.s},
                          result_pk.keyPair.Q
                        );
                      }
                      return device_id().then(function (devid) {
                        if (session_for_login && session_for_login.nc === nconn) {
                          return session_for_login.call('com.greenaddress.login.authenticate', [
                            [signature.r.toString(), signature.s.toString(), i.toString()],
                            logout || false,
                            'GA',
                            devid
                          ]).then(function (data) {
                            if (data) {
                              txSenderService.logged_in = data;
                              onLogin(data);
                              return data;
                            } else { return $q.reject(gettext('Login failed')); }
                          });
                        } else if (!connecting) {
                          disconnected = false;
                          d = $q.defer();
                          connect(d);
                          return d.promise;
                        }
                      });
                    });
                  });
                });
              }
            }).finally(function () { waiting_for_device = false; }));
          } else if (!connecting) {
            disconnected = false;
            d = $q.defer();
            connect(d);
            d_main.resolve(d.promise);
          }
        });
      }
    }
    return d_main.promise;
  }
  function logout () {
    if (session) {
      connection.close();
      session = session_for_login = null;
      txSenderService.gawallet = null;
      disconnected = true;
    }
    for (var key in calls_missed) {
      delete calls_missed[key];
    }
    if (txSenderService.btchip) {
      txSenderService.btchip.dongle.disconnect_async();
    }
    disconnected = true;
    txSenderService.logged_in = false;
    attempt_login = false;
    txSenderService.hdwallet = undefined;
    txSenderService.trezor_dev = undefined;
    txSenderService.watch_only = undefined;
    txSenderService.pin_ident = undefined;
    txSenderService.has_pin = undefined;
    if (txSenderService.wallet) txSenderService.wallet.clear();
  }
  function loginWatchOnly (token_type, token, logout) {
    var d = $q.defer();
    txSenderService.call('com.greenaddress.login.watch_only', token_type, token, logout || false)
      .then(function (data) {
        txSenderService.watch_only = [token_type, token];
        onLogin(data);
        d.resolve(data);
      }, function (err) {
        d.reject(err);
      });
    return d.promise;
  }
  function change_pin (new_pin) {
    return txSenderService.call('com.greenaddress.pin.change_pin_login', new_pin, txSenderService.pin_ident)
      .then(function (res) {
        // keep new pin for reconnection handling
        if (!res) {
          return $q.reject(gettext('Changing PIN failed.'));
        } else {
          txSenderService.pin = new_pin;
        }
      });
  }
}
