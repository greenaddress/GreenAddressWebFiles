var window = require('global/window');
var is_chrome_app = require('has-chrome-storage');

var Bitcoin = window.Bitcoin;

module.exports = factory;

factory.dependencies = ['$rootScope', '$q', 'cordovaReady', 'notices'];

function factory ($rootScope, $q, cordovaReady, notices) {
  var iframe;
  return function (key, passphrase) {
    var data = key.keyPair || key; // either HDNode or ECPair
    if (!passphrase) {
      return $q.when(data.toWIF());
    } else {
      var d = $q.defer();
      if (window.cordova) {
        cordovaReady(function () {
          window.cordova.exec(function (b58) {
            d.resolve(b58);
          }, function (fail) {
            $rootScope.decrementLoading();
            notices.makeNotice('error', fail);
            d.reject(fail);
          }, 'BIP38', 'encrypt', [
            Array.from(data.d.toBuffer()),
            passphrase,
            (window.cur_net === Bitcoin.bitcoin.networks.bitcoin
              ? 'BTC'
              : 'BTT')
          ]);
        })();
      } else if (is_chrome_app) {
        var process = function () {
          var listener = function (message) {
            window.removeEventListener('message', listener);
            d.resolve(message.data);
          };
          window.addEventListener('message', listener);
          iframe.contentWindow.postMessage({
            eckey: data.toWIF(),
            network: window.cur_net,
            password: passphrase
          }, '*');
        };
        if (!iframe) {
          if (document.getElementById('id_iframe_send_bip38')) {
            iframe = document.getElementById('id_iframe_send_bip38');
            process();
          } else {
            iframe = document.createElement('IFRAME');
            iframe.onload = process;
            iframe.setAttribute('src', '/bip38_sandbox.html');
            iframe.setAttribute('class', 'ng-hide');
            iframe.setAttribute('id', 'id_iframe_send_bip38');
            document.body.appendChild(iframe);
          }
        } else {
          process();
        }
      } else {
        var worker = new window.Worker('/static/js/greenwallet/signup/bip38_worker.js');
        worker.onmessage = function (message) {
          d.resolve(message.data);
        };
        worker.postMessage({
          eckey: data.toWIF(),
          network: window.cur_net,
          password: passphrase
        });
      }
      return d.promise;
    }
  };
}
