module.exports = factory;

factory.dependencies = ['$rootScope', '$timeout', 'cordovaReady'];

function factory ($rootScope, $timeout, cordovaReady) {
  return function (name) {
    $timeout(function () {
      $rootScope.$broadcast('focusOn', name);
    /* doesn't work very well
    if (window.cordova) {
        cordovaReady(function() {
            window.plugins.SoftKeyboard.show()
        })()
    } */
    });
  };
}
