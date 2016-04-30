var app = require('./app');
var raf = require('raf');

app.run(['$templateCache', '$uibModal', function($templateCache, uid) {
  // we wait eeevvveerryyything loaded
  process.nextTick(function() {
    var content = $templateCache.get("uib/template/typeahead/typeahead-popup.html");
    content = content.replace(/\)\}\}/g, ') }}');
    $templateCache.put("uib/template/typeahead/typeahead-popup.html", content);
  });
}]);
