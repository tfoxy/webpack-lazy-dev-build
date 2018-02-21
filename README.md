# webpack-lazy-dev-build

## Minimum setup

```js
const express = require('express');
const WebpackDevMiddleware = require('webpack-dev-middleware');
const LazyBuild = require('webpack-lazy-dev-build');
const webpackConfig = require('./webpack.config');

const lazyBuild = new LazyBuild();
webpackConfig.plugins.push(lazyBuild.plugin);
const compiler = webpack(webpackConfig);
const devMiddleware = WebpackDevMiddleware(compiler);
const app = express();

app.use(lazyBuild.createMiddleware(devMiddleware));

app.listen(3000);
```
