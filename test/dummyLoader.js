module.exports = dummyLoader;

function dummyLoader(source) {
  return dummyLoader.loader(source);
}
