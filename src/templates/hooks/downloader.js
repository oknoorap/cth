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
 */
exports.post = file => {
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
  return file
}
