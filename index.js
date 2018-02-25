const { getFilenameFromUrl, handleRequest } = require('webpack-dev-middleware/lib/util');

class LazyBuild {
  constructor() {
    this.plugin = new WebpackLazyDevBuildPlugin(this);
    this.requestedFiles = new Set();
    this.neededModules = new Set();
  }

  createMiddleware(devMiddleware) {
    return (req, res, next) => {
      if (req.method !== 'GET') {
        return next();
      }

      const { context } = devMiddleware;
      const reqFilename = getFilenameFromUrl(context.options.publicPath, context.compiler, req.url);
      if (reqFilename === false) {
        return next();
      }

      const processFile = (filename) => {
        if (context.webpackStats && !this.requestedFiles.has(filename)) {
          this.requestedFiles.add(filename);
          const stats = context.webpackStats.stats || [context.webpackStats];
          const modifiedStats = stats.find(({ compilation }) => {
            let { outputPath } = compilation.compiler;
            if (!outputPath.endsWith('/')) outputPath += '/';
            if (!filename.startsWith(outputPath)) return;
            const chunkFilename = filename.slice(outputPath.length);
            const filteredChunks = compilation.chunks.filter((chunk) => {
              return chunk.files.includes(chunkFilename);
            });
            if (!filteredChunks.length) return;
            filteredChunks.forEach((chunk) => {
              chunk.forEachModule((module) => {
                this.neededModules.add(module.resource || module.debugId);
              });
            });
            return true;
          });
          if (modifiedStats) {
            this._recompile(context, modifiedStats.compilation.compiler);
          }
        }
      };

      const assetUrl = this.getAssetUrl(req.url);
      if (assetUrl && assetUrl !== req.url) {
        const assetFilename = getFilenameFromUrl(context.options.publicPath, context.compiler, assetUrl);
        if (assetFilename !== false) {
          const assetReq = Object.assign({}, req);
          assetReq.url = assetUrl;
          processFile(assetFilename);
          return handleRequest(context, assetFilename, () => {
            processFile(reqFilename);
            return devMiddleware(req, res, next);
          }, assetReq);
        }
      }

      processFile(reqFilename);
      return devMiddleware(req, res, next);
    }
  }

  _recompile(context, compiler) {
    context.state = false;
    const watchings = context.watching.watchings || [context.watching];
    const watching = watchings.find(w => w.compiler === compiler);
    watching.pausedWatcher = watching.watcher;
    watching.watcher = null;

    const timestamps = compiler.watchFileSystem.watcher.getTimes();    
    compiler.fileTimestamps = timestamps;
    compiler.contextTimestamps = timestamps;

    watching.invalidate();
  }

  getAssetUrl(url) {
    if (url.endsWith('.css')) {
      url = url.slice(0, -4) + '.js';
    }
    return url;
  }
}

class WebpackLazyDevBuildPlugin {
  constructor(lazyBuild) {
    this.lazyBuild = lazyBuild;
  }

  apply(compiler) {
    compiler.plugin('compilation', (compilation) => {
      compilation.plugin('build-module', (module) => {
        if (this.lazyBuild.neededModules.has(module.resource || module.debugId)) return;
        const isLazy = module.reasons.every((reason) => {
          const { type } = reason.dependency;
          return type === 'import()' || type === 'single entry';
        });
        if (isLazy) {
          module.building = [];
          setTimeout(() => {
            const { building } = module;
            module.building = undefined;
            building.forEach(cb => cb());
          });
        } else {
          this.lazyBuild.neededModules.add(module.resource || module.debugId);
        }
      });
    });
  }
}

module.exports = LazyBuild;
