var extend = require('xtend/mutable');

module.exports = GAFeeEstimatesFactory;

extend(GAFeeEstimatesFactory.prototype, {
  getFeeEstimate: getFeeEstimate
});

function GAFeeEstimatesFactory (gaService, initialEstimates) {
  this.gaService = gaService;
  this.estimates = initialEstimates;
  gaService.session.subscribe('com.greenaddress.fee_estimates',
    function (event) {
      this.estimates = event[0];
    }.bind(this)
  );
}

function getFeeEstimate (confs) {
  var estimate = this.estimates[confs];
  if (+estimate['feerate'] > 0) {
    return [
      /* satoshis = */ 1000 * 1000 * 100 * estimate['feerate'],
      estimate['blocks']
    ];
  } else {
    return [10000, 1];
  }
}
