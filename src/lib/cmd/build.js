const path = require('path')
const {readFileSync, statSync} = require('fs')
const crypto = require('crypto')
const csv = require('fast-csv')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const slugify = require('node-slugify')
const hbs = require('handlebars')
const download = require('download')
const moment = require('moment')
const urljoin = require('url-join')
const message = require('../messages')
const logger = require('../logger')
const compiler = require('../compiler')
const {isFileExists, isDirExists, readFile} = require('../helpers')

module.exports = async ({csvFile}, {clean, overwrite}) => {
  const cwd = process.cwd()

  if (!isFileExists(cwd, 'project.json') &&
    !isDirExists(cwd, 'csv') &&
    !isDirExists(cwd, 'dist') &&
    !isDirExists(cwd, 'hooks') &&
    !isDirExists(cwd, 'pages') &&
    !isDirExists(cwd, 'themes')) {
    logger.error(message.NOT_IN_PROJECT_FOLDER)
  }

  const _csvdir = path.join(cwd, 'csv')
  let _csvlist = []

  if (csvFile === undefined) {
    _csvlist = compiler.scandir(_csvdir).filter(item => {
      return path.extname(item) === '.csv'
    })
  } else {
    _csvlist.push(`${csvFile}.csv`)
  }

  _csvlist.forEach(item => {
    if (!isFileExists(cwd, 'csv', item)) {
      logger.error(message.INVALID_CSV_FILE)
    }
  })

  if (_csvlist.length === 0) {
    logger.error(message.NO_CSV_FILE)
  }

  const isOverwrite = overwrite !== undefined
  const overwriteAll = isOverwrite && overwrite === 'all'
  const overwritePage = isOverwrite && overwrite === 'page'
  const overwriteItem = isOverwrite && overwrite === 'item'
  const overwriteImage = isOverwrite && overwrite === 'image'
  const {site, meta, settings} = require(path.join(cwd, 'project.json'))
  const _themepath = path.join(cwd, 'themes', settings.theme)
  const _distpath = path.join(cwd, 'dist')
  const _hookspath = path.join(cwd, 'hooks')
  const _pagepath = path.join(cwd, 'pages')
  const _uploadpath = path.join(_distpath, settings.slug.upload)
  const _itempath = path.join(_distpath, settings.slug.item)
  const loader = logger.loader(message.BUILD_LOADING)

  // Is cleanup?
  if (clean) {
    rimraf.sync(path.join(_distpath, '*'))
  }

  // Directory creation.
  mkdirp.sync(_uploadpath)
  mkdirp.sync(_itempath)

  // Register / define hooks.
  let $buildHooks = {
    pre: data => data,
    post: data => data,
    each: item => item
  }

  let $helperHooks = {
    slugify,
    include: filepath => {
      const _incpath = path.join(_themepath, filepath)
      if (isFileExists(_incpath)) {
        return readFileSync(_incpath, 'utf-8')
      }

      return ''
    }
  }

  let $downloaderHooks = {
    pre: url => url,
    post: () => new Promise(resolve => resolve)
  }

  // Overwrite custom hooks.
  if (isFileExists(_hookspath, 'build.js')) {
    $buildHooks = require(path.join(_hookspath, 'build'))
  }

  if (isFileExists(_hookspath, 'helpers.js')) {
    $helperHooks = Object.assign($helperHooks, require(path.join(_hookspath, 'helpers')))
  }

  for (const fnName in $helperHooks) {
    if (Object.prototype.hasOwnProperty.call($helperHooks, fnName)) {
      hbs.registerHelper(fnName, $helperHooks[fnName])
    }
  }

  if (isFileExists(_hookspath, 'downloader.js')) {
    $downloaderHooks = Object.assign($downloaderHooks, require(path.join(_hookspath, 'downloader')))
  }

  // Register Default Templates.
  const templates = {
    header: readFile(_themepath, 'header.hbs'),
    footer: readFile(_themepath, 'footer.hbs')
  }

  for (const tplName in templates) {
    if (Object.prototype.hasOwnProperty.call(templates, tplName)) {
      hbs.registerPartial(tplName, templates[tplName])
    }
  }

  // Define default syntax.
  const defaultSyntax = (customSyntax = {}, extractData) => {
    const is = {
      home: false,
      item: false,
      page: false,
      sitemap: false,
      robot: false,
      imgdownloaded: false
    }

    const syntax = Object.assign({site, meta, settings, is}, customSyntax)
    const data = Object.assign({}, extractData)

    for (const propName in data) {
      if (Object.prototype.hasOwnProperty.call(data, propName)) {
        data[propName] = hbs.compile(data[propName])(syntax)
      }
    }

    const output = Object.assign(syntax, data)
    if (output.slug) {
      output.slug = slugify(output.slug)
    }

    return output
  }

  // Build Files Map.
  const buildMap = filename => new Promise(resolve => {
    loader.text = `Compile ${filename}`

    const csvPath = path.join(cwd, 'csv', filename)
    const itemTplPath = [_themepath, 'item.hbs']
    let items = []

    // Build Item Map.
    const itemMap = (item, index) => new Promise(async resolve => {
      const syntax = defaultSyntax({
        item,
        is: {item: true}
      }, meta.item)
      const slug = syntax.slug || index
      const dstPath = path.join(_itempath, `${slug}.html`)

      item.$syntax = syntax
      item.$dstPath = dstPath

      // Download images.
      const {saveimg, imgcolumn} = settings.data
      const saveImage = new Promise(async (resolve, reject) => {
        if (saveimg && imgcolumn in item) {
          const imageHash = crypto.createHash('md5').update(item[imgcolumn]).digest('hex')
          const imageExt = path.extname(item[imgcolumn])
          const imageName = `${slug}-${imageHash}${imageExt}`
          const _imgpath = path.join(_uploadpath, imageName)

          // Apply pre downloader hooks.
          const imgUrl = $downloaderHooks.pre(item[imgcolumn])
          item[imgcolumn] = imgUrl

          if (isFileExists(_imgpath)) {
            item[imgcolumn] = urljoin(site.url, settings.slug.upload, imageName)
          }

          if ((imgUrl && !isFileExists(_imgpath)) || overwriteImage) {
            const downloadImage = download(imgUrl, _uploadpath, {filename: imageName})
            await downloadImage.then(async () => {
              item[imgcolumn] = urljoin(site.url, settings.slug.upload, imageName)
              syntax.is.imgdownloaded = true

              const postDownload = $downloaderHooks.post(_imgpath)
              await postDownload.then(resolve).catch(reject)
            }).catch(reject)
          } else {
            resolve()
          }
        } else {
          resolve()
        }
      })

      // Compile item.
      await saveImage.then(() => {
        resolve(item)
      }).catch(err => {
        logger.error(err, false)
        resolve(item)
      })
    })

    // Build Items.
    const buildItems = async () => {
      // Apply pre build hooks.
      if (typeof $buildHooks.pre === 'function') {
        items = $buildHooks.pre(items)
      }

      const buildItem = Promise.all(items.map(itemMap))
      const compileMultipleItem = new Promise(async resolve => {
        await buildItem.then(items => {
          if (isFileExists(...itemTplPath) && settings.data.multiple) {
            items.forEach(item => {
              // Apply each item hooks.
              item = $buildHooks.each(item)

              if (!isFileExists(item.$dstPath) || overwriteItem) {
                compiler.single({
                  srcPath: path.join(...itemTplPath),
                  dstPath: item.$dstPath,
                  syntax: Object.assign(item.$syntax, {
                    item: [item],
                    items
                  })
                })
              }
            })
          }

          resolve()
        }).catch(logger.error)
      })

      const compileNonMultipleItem = new Promise(async resolve => {
        await buildItem.then(items => {
          if (items && isFileExists(...itemTplPath) && !settings.data.multiple) {
            let title = 'Untitled'

            items.forEach((item, index) => {
              // Apply each item hooks.
              items[index] = $buildHooks.each(item)

              if (item.title) {
                title = item.title
              }
            })

            const slug = slugify(title)
            const dstPath = path.join(_itempath, `${slug}.html`)

            if (!isFileExists(...dstPath) || overwriteItem) {
              compiler.single({
                srcPath: path.join(...itemTplPath),
                dstPath,
                syntax: defaultSyntax({
                  item: items,
                  is: {
                    item: true
                  }
                }, meta.item)
              })
            }
          }

          resolve()
        }).catch(logger.error)
      })

      // Apply post build hooks.
      const buildParalel = Promise.all([
        compileMultipleItem,
        compileNonMultipleItem
      ])

      await buildParalel.then(() => {
        if (typeof $buildHooks.post === 'function') {
          items = $buildHooks.post(items)
        }

        resolve({
          file: csvPath,
          lastmod: moment(new Date(statSync(csvPath).mtime)).unix(),
          items
        })
      }).catch(logger.error)
    }

    // Read CSV.
    csv.fromPath(csvPath, {headers: true})
      .on('data', item => items.push(item))
      .on('end', buildItems)
  })

  // Build CSV.
  const build = Promise.all(_csvlist.map(buildMap))

  // Compile Home.
  const buildHome = new Promise(async resolve => {
    const srcPath = [_themepath, 'home.hbs']
    const dstPath = path.join(_distpath, 'index.html')

    await build.then(items => {
      loader.text = 'Compile home'

      if (isFileExists(...srcPath)) {
        const syntax = defaultSyntax({
          items,
          is: {home: true}
        }, meta.home)

        compiler.single({
          srcPath: path.join(...srcPath),
          dstPath,
          syntax
        })
      }

      resolve()
    }).catch(logger.error)
  })

  // Compile Pages.
  const buildPages = new Promise(async resolve => {
    const srcPath = [_themepath, 'page.hbs']
    const pages = compiler.scandir(path.join(cwd, 'pages'))

    const buildPageItem = item => {
      const pageExt = path.extname(item)
      const pageName = path.basename(item, pageExt)
      const dstPath = path.join(_distpath, `${pageName}.html`)
      const isPageExists = pageName in meta.pages && pageExt === '.hbs'

      if (isPageExists && (!isFileExists(dstPath) || overwriteAll || overwritePage)) {
        const page = Object.assign({
          content: readFileSync(path.join(_pagepath, item))
        }, meta.pages[pageName])

        const syntax = defaultSyntax({
          is: {page: true},
          page
        }, meta.pages[pageName])

        compiler.single({
          srcPath: path.join(...srcPath),
          dstPath,
          syntax
        })
      }
    }

    await buildHome.then(() => {
      loader.text = 'Compile pages'

      if (isFileExists(...srcPath)) {
        pages.forEach(buildPageItem)
      }

      resolve()
    }).catch(logger.error)
  })

  // Compile sitemap.
  const buildSitemap = new Promise(async resolve => {
    await buildPages.then(() => {
      loader.text = 'Compile sitemap.xml'

      const sitemaps = []

      // Add pages.
      for (const page in meta.pages) {
        if (Object.prototype.hasOwnProperty.call(meta.pages, page)) {
          const _pagepath = path.join(_distpath, page)
          const _time = moment(new Date(statSync(`${_pagepath}.html`).mtime))
          const url = `${site.url}/${page}.html`
          const lastmod = _time.format('YYYY-MM-DD')

          sitemaps.push({url, lastmod})
        }
      }

      // Add items.
      const items = compiler.scandir(_itempath)
      items.forEach(item => {
        const _time = moment(new Date(statSync(path.join(_itempath, item)).mtime))
        const lastmod = _time.format('YYYY-MM-DD')
        const url = `${site.url}/${settings.slug.item}/${item}`

        sitemaps.push({url, lastmod})
      })

      // Build sitemap.xml
      const srcPath = [_themepath, 'sitemap.hbs']
      const dstPath = path.join(_distpath, 'sitemap.xml')
      const syntax = defaultSyntax({
        sitemaps,
        is: {sitemap: true}
      })

      if (isFileExists(...srcPath)) {
        compiler.single({
          srcPath: path.join(...srcPath),
          dstPath,
          syntax
        })
      }

      // Copy xsl.
      const xslSrcPath = [_themepath, 'sitemap.xsl']
      const xslDstPath = path.join(_distpath, 'sitemap.xsl')
      if (isFileExists(...xslSrcPath) && (!isFileExists(xslDstPath) || overwriteAll)) {
        compiler.single({
          srcPath: path.join(...xslSrcPath),
          dstPath: xslDstPath,
          syntax: defaultSyntax({
            is: {sitemap: true}
          })
        })
      }

      resolve()
    }).catch(logger.error)
  })

   // Compile robots.txt.
  const buildRobots = new Promise(async resolve => {
    const srcPath = [_themepath, 'robots.txt']
    const dstPath = path.join(_distpath, 'robots.txt')
    const syntax = defaultSyntax({
      is: {
        robot: true
      }
    })

    await buildSitemap.then(() => {
      loader.text = 'Compile robots.txt'

      if (isFileExists(...srcPath)) {
        compiler.single({
          srcPath: path.join(...srcPath),
          dstPath,
          syntax
        })
      }
      resolve()
    }).catch(logger.error)
  })

  // Copy assets from theme.
  const copyAssets = new Promise(async resolve => {
    const assets = [_themepath, 'assets']

    await build.then(() => {
      if (isDirExists(...assets)) {
        compiler.bulk({
          srcDir: path.join(...assets),
          dstDir: path.join(_distpath, 'assets')
        })
      }

      resolve()
    })
  })

  // Done.
  Promise.all([
    buildHome,
    buildSitemap,
    buildPages,
    buildRobots,
    copyAssets
  ]).then(() => {
    setTimeout(() => {
      loader.clear()
      loader.stop()
      logger.success(message.DONE)
    }, 1000)
  }).catch(logger.error)
}
