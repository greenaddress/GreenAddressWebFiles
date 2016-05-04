module.exports = factory;

factory.dependencies = ['parseKeyValue'];

function factory (parseKeyValue) {
  return function parse_bitcoin_uri (uri) {
    if (uri.indexOf === undefined || uri.indexOf('bitcoin:') === -1) {
      // not a URI
      return {};
    } else {
      if (uri.indexOf('?') === -1) {
        // no amount
        return {recipient: uri.split('bitcoin:')[1]};
      } else {
        var recipient = uri.split('bitcoin:')[1].split('?')[0];
        var variables = parseKeyValue(uri.split('bitcoin:')[1].split('?')[1]);
        variables.recipient = recipient;
        return variables;
      }
    }
  };
}
