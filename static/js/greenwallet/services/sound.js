var window = require('global/window');

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
        if (typeof Audio !== 'undefined') {
          // HTML5 Audio
          $timeout(function () { new Audio(src).play(); });
        } else {
          console.log('no sound API to play: ' + src);
        }
      })();
    }
  };
}
