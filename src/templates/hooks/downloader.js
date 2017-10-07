/**
 * Image downloader hooks, before and after downloading image.
 * You can manipulate file after image download.
 */

/**
 * Before download image.
 */
exports.pre = url => {
  return url
}

/**
 * After images downloaded to `settings.slug.uploads` directory.
 * @param String file
 */
exports.post = () => {
  return new Promise(resolve => {
    // Example
    // const fs = require('fs')
    // const sharp = require('sharp')
    // sharp(file).flop().toBuffer((err, buffer) => {
    //   if (err) {
    //     throw err
    //   }

    //   fs.writeFile(file, buffer, err => {
    //     if (err) {
    //       throw err
    //     }
    //   })
    // })
    resolve()
  })
}
