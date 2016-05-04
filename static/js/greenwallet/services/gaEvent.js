var window = require('global/window');

module.exports = factory;

function factory () {
  return gaEvent;

  function gaEvent (category, action, label) {
    if (window._gaq) {
      var _gaq = window._gaq;
      try {
        if (category === '_pageview') {
          _gaq.push(['_trackPageview', action]);
        } else {
          _gaq.push(['_trackEvent', category, action, label]);
        }
      } catch (e) {}
    }
  }
}
