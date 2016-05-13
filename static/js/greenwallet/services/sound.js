var window = require('global/window');

var Media = window.Media;
var Audio = window.Audio;

module.exports = factory;

factory.dependencies = ['cordovaReady', '$timeout'];

function factory (cordovaReady, $timeout) {
  return {
    play: function (src, $scope) {
      cordovaReady(function () {
        if (!$scope || !$scope.wallet.appearance.sound) {
          return;
        }
        if (window.cordova && typeof Media !== 'undefined') {
          // Phonegap media
          var mediaRes = new Media(src,
            function onSuccess () {
              // release the media resource once finished playing
              mediaRes.release();
            },
            function onError (e) {
              console.log('error playing sound: ' + JSON.stringify(e));
            });
          mediaRes.play();
        } else if (typeof Audio !== 'undefined') {
          // HTML5 Audio
          $timeout(function () { new Audio(src).play(); });
        } else {
          console.log('no sound API to play: ' + src);
        }
      })();
    }
  };
}
