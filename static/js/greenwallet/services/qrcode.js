var window = require('global/window');
var angular = require('angular');

var cordova = window.cordova;
var gettext = window.gettext;
var qrcode = window.qrcode;
var Image = window.Image;
var URL = window.URL;

module.exports = factory;

factory.dependencies = ['$q', 'cordovaReady', '$timeout', 'notices'];

function factory ($q, cordovaReady, $timeout, notices) {
  var n = navigator;
  var v;
  var webkit = false;
  var moz = false;
  var gCtx;
  var stream;
  return {
    stop_scanning: function ($scope) {
      $scope.scanning_qr_video = false;
      v.pause();
      try {
        stream.stop();
      } catch (e) {
        stream.getVideoTracks()[0].stop();
      }
    },
    scan: function ($scope, $event, suffix) {
      var that = this;
      var deferred = $q.defer();
      if (cordova) {
        $event.preventDefault();
        cordovaReady(function () {
          cordova.plugins.barcodeScanner.scan(
            function (result) {
              console.log('We got a barcode\n' +
                'Result: ' + result.text + '\n' +
                'Format: ' + result.format + '\n' +
                'Cancelled: ' + result.cancelled);
              if (!result.cancelled && result.format === 'QR_CODE') {
                $timeout(function () { deferred.resolve(result.text); });
              } else {
                if (result.cancelled) {
                  $timeout(function () { deferred.reject(gettext('Cancelled')); });
                } else {
                  $timeout(function () { deferred.reject(gettext('Invalid format')); });
                }
              }
            },
            deferred.reject
          );
        })();
      } else {
        v = document.getElementById('v' + (suffix || ''));
        qrcode.callback = function (result) {
          if (result === 'error decoding QR Code') {
            deferred.reject(gettext('Could not process the QR code, the image may be blurry. Please try again.'));
            return;
          }
          deferred.resolve(result);
        };
        var success = function (stream_) {
          $scope.$apply(function () {
            $scope.scanning_qr_video = true;
          });
          stream = stream_;
          var gCanvas = document.getElementById('qr-canvas');
          var w = 800;
          var h = 600;
          gCanvas.style.width = w + 'px';
          gCanvas.style.height = h + 'px';
          gCanvas.width = w;
          gCanvas.height = h;
          gCtx = gCanvas.getContext('2d');
          gCtx.clearRect(0, 0, w, h);
          if (webkit) {
            v.src = window.webkitURL.createObjectURL(stream);
          } else if (moz) {
            v.mozSrcObject = stream;
            v.play();
          } else {
            v.src = stream;
          }
          setTimeout(captureToCanvas, 500);
        };
        var error = function () {
          $scope.gotGUMerror = true; // for some reason dispatchEvent doesn't work inside error()
          deferred.reject(gettext('Access denied. Retry to scan from file.'));
        };
        var scan_input = function () {
          var qr = $event.target;
          angular.element(qr).on('change', function (event) {
            if (event.target.files.length !== 1 && event.target.files[0].type.indexOf('image/') !== 0) {
              notices.makeNotice('error', gettext('You must provide only one image file.'));
              return;
            }

            // https://github.com/kyledrake/coinpunk/blob/master/public/js/coinpunk/controllers/tx.js#L195
            /*! Copyright (c) 2013, Kyle Drake */

            var canvas = document.getElementById('qr-canvas');
            if (!canvas) {
              canvas = document.createElement('canvas');
            }
            var context = canvas.getContext('2d');
            var img = new Image();
            img.onload = function () {
              /*
              Helpful URLs:
              http://hacks.mozilla.org/2011/01/how-to-develop-a-html5-image-uploader/
              http://stackoverflow.com/questions/19432269/ios-html5-canvas-drawimage-vertical-scaling-bug-even-for-small-images

              There are a lot of arbitrary things here. Help to clean this up welcome.

              context.save()
              context.scale(1e6, 1e6)
              context.drawImage(img, 0, 0, 1e-7, 1e-7, 0, 0, 1e-7, 1e-7)
              context.restore()
              */

              if ((img.width === 2448 && img.height === 3264) || (img.width === 3264 && img.height === 2448)) {
                canvas.width = 1024;
                canvas.height = 1365;
                context.drawImage(img, 0, 0, 1024, 1365);
              } else if (img.width > 1024 || img.height > 1024) {
                canvas.width = img.width * 0.15;
                canvas.height = img.height * 0.15;
                context.drawImage(img, 0, 0, img.width * 0.15, img.height * 0.15);
              } else {
                canvas.width = img.width;
                canvas.height = img.height;
                context.drawImage(img, 0, 0, img.width, img.height);
              }
              qrcode.decode(canvas.toDataURL('image/png'));
            };

            img.src = URL.createObjectURL(event.target.files[0]);
          });
        };
        var tryGUM = function (source) {
          if (n.getUserMedia && !$scope.gotGUMerror) {
            n.getUserMedia({video: source, audio: false}, success, error);
            $event.preventDefault();
          } else if (n.webkitGetUserMedia && !$scope.gotGUMerror) {
            webkit = true;
            n.webkitGetUserMedia({video: source, audio: false}, success, error);
            $event.preventDefault();
          } else if (n.mozGetUserMedia && !$scope.gotGUMerror) {
            moz = true;
            n.mozGetUserMedia({video: source, audio: false}, success, error);
            $event.preventDefault();
          } else {
            scan_input();
          }
        };
        if (window.MediaStreamTrack && window.MediaStreamTrack.getSources && !$scope.gotGUMerror) {
          $event.preventDefault();
          window.MediaStreamTrack.getSources(function (sources) {
            var found = false;
            for (var i = 0; i < sources.length; i++) {
              if (sources[i].kind === 'video' && sources[i].facing === 'environment') {
                found = true;
                tryGUM({optional: [{sourceId: sources[i].id}]});
                break;
              }
            }
            if (!found) tryGUM(true);
          });
        } else {
          tryGUM(true);
        }
      }
      return deferred.promise;

      function captureToCanvas () {
        try {
          gCtx.drawImage(v, 0, 0);
          try {
            qrcode.decode();
            that.stop_scanning($scope);
          } catch (e) {
            console.error(e.stack || e);
            setTimeout(captureToCanvas, 500);
          }
        } catch (e) {
          console.error(e.stack || e);
          setTimeout(captureToCanvas, 500);
        }
      }
    }
  };
}
