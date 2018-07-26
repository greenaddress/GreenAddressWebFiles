var extend = require('xtend/mutable');

module.exports = GAFeeEstimatesFactory;

extend(GAFeeEstimatesFactory.prototype, {
  getFeeEstimate: getFeeEstimate
});

function GAFeeEstimatesFactory (gaService, initialEstimates) {
  this.gaService = gaService;
  this.estimates = initialEstimates;
  var _this = this;
  gaService.addNotificationCallback('feeEstimates', function (event) {
    _this.estimates = event[0];
  });
}

function getFeeEstimate (confs) {
  var sortedEstimates = Object.keys(this.estimates).sort(
    function (a, b) {
      return +a - +b;
    }
  );

  for (var i = 0; i < sortedEstimates.length; ++i) {
    var estimate = this.estimates[sortedEstimates[i]];
    var feeRate = +estimate['feerate'];
    if (feeRate < 0) {
      continue;
    }
    var actualBlock = +estimate['blocks'];
    if (actualBlock < confs) {
      continue;
    }
    return [feeRate * 1000 * 1000 * 100, actualBlock];
  }

  return [this.gaService.getMinFeeRate() * 1, 1];
}
