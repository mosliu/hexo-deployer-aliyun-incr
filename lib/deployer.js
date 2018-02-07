const pathFn = require('path');
const fs = require('hexo-fs');
const OSS = require('ali-oss').Wrapper;
const Promise = require('bluebird');
const chalk = require('chalk');
// const conf = require('../config/alioss.json');
const crypto = require('crypto');


/**
 * 计算传入的文件的md5值,无则回传null
 *
 * @param {any} filePath 文件路径
 */
function getMd5Hash(filePath) {
  if (fs.existsSync(filePath)) {
    const md5 = crypto.createHash('md5');
    const result = md5.update(fs.readFileSync(filePath)).digest('hex');
    return result;
  }
  return null;
}
/**
   * 检查传入的文件是否在列表中，或者是否更新
   * 如果不在列表中或已更新，则返回true
   * 否则返回false
   *
   * @param {string} absPath 传入文件路径
   * @param {List} fileList 列表 [{absPath:"aaa",md5:"bbb"},]
   * @returns
   */
function isFileUpdated(absPath, fileList) {
  for (let i = fileList.length - 1; i >= 0; i -= 1) {
    if (absPath === fileList[i].absPath) {
      const md5 = getMd5Hash(absPath);
      if (md5 !== null && md5 === fileList[i].md5) {
        return false;
      }
      break;
    }
  }
  return true;
}


/**
   * 更新列表中的md5内容
   *
   * @param {string} absPath 传入文件路径
   * @param {List} fileList 列表 [{absPath:"aaa",md5:"bbb"},]
   */
function updateMd5InFilesList(absPath, fileList) {
  const md5 = getMd5Hash(absPath);
  let changedFlag = false;
  for (let i = fileList.length - 1; i >= 0; i -= 1) {
    if (absPath === fileList[i].absPath) {
      fileList[i].md5 = md5;
      changedFlag = true;
      break;
    }
  }
  if (changedFlag === false) {
    fileList.push({ absPath, md5 });
  }
}
/**
   * 加载过去上传过的文件列表
   *
   * @param {string} infoFilePath
   * @returns 列表List
   */
function loadOldUploadedFiles(infoFilePath) {
  let uploadedFiles = [];
  if (fs.existsSync(infoFilePath)) {
    const fcontent = fs.readFileSync(infoFilePath);
    uploadedFiles = JSON.parse(fcontent);
  } else {
    fs.writeFileSync(infoFilePath, '[]');
    console.log('创建old.uploaded.info文件');
  }
  return uploadedFiles;
}


/**
   * 遍历文件，使用handle处理
   *
   * @param {any} dir
   * @param {function} handle
   */
function traverseFiles(dir, handle) {
  const infoFilePath = 'alioss.old.uploaded.info';
  const uploadedFiles = loadOldUploadedFiles(infoFilePath);
  const files = fs.listDirSync(dir);
  files.forEach((filePath) => {
    const absPath = pathFn.join(dir, filePath);
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      traverseFiles(absPath, handle);
    } else if (isFileUpdated(absPath, uploadedFiles)) {
      handle(absPath);
      updateMd5InFilesList(absPath, uploadedFiles);
      console.log(chalk.cyan(`${absPath} changed,updated`));
    } else {
      console.log(chalk.blue(`${absPath} not chang,skipped`));
    }
  });
  fs.writeFileSync(infoFilePath, JSON.stringify(uploadedFiles));
}


function getUploadPath(absPath, root) {
  let pathArr = absPath.split(pathFn.sep);
  const rootIndex = pathArr.indexOf(root);
  pathArr = pathArr.slice(rootIndex + 1);
  return pathArr.join('/');
}

function doDeploy(args, callback) {
  const publicDir = this.public_dir;
  const log = this.log;
  const uploadFileList = [];

  let conf = {};
  if (fs.existsSync('config/alioss.json')) {
    console.log("Load conf From 'config/alioss.json'");
    conf = JSON.parse(fs.readFileSync('config/alioss.json'));
  } else if (args.bucket && args.region && args.accessKeyId && args.accessKeySecret) {
    conf = {
      bucket: args.bucket,
      region: args.region,
      accessKeyId: args.accessKeyId,
      accessKeySecret: args.accessKeySecret,
    };
  } else {
    const help = [
      'You should argsure deployment settings in _config.yml first!',
      '',
      'Example:',
      '  deploy:',
      '    type: aliyun',
      '    bucket: yourBucketName',
      '    region: yourOSSregion',
      '    accessKeyId: yourAccessKeyId',
      '    accessKeySecret: yourAccessKeySecret',
      '',
      `For more help, you can check the docs: ${chalk.underline('http://hexo.io/docs/deployment.html')} and ${chalk.underline('https://help.aliyun.com/document_detail/31867.html?spm=5176.doc31950.2.1.WMtDHS')}`,
    ];
    console.log(help.join('\n'));
    log.error('config error');
    return;
  }

  const client = new OSS({
    region: conf.region,
    accessKeyId: conf.accessKeyId,
    accessKeySecret: conf.accessKeySecret,
    bucket: conf.bucket,
  });

  log.info('Uploading files to Aliyun...');

  // get all files sync
  traverseFiles(publicDir, (file) => {
    uploadFileList.push({
      uploadPath: getUploadPath(file, pathFn.basename(publicDir)),
      file,
    });
  });

  // upload
  return Promise.map(uploadFileList, item => client.put(item.uploadPath, item.file)
    .then((result) => {
      log.info(`${result.name} uploaded`);
      return result;
    })
    .catch((err) => {
      log.error(err);
      throw err;
    }), { concurrency: 3 })
    .then(() => client.putBucketWebsite(conf.bucket, conf.region, {
      index: 'index.html',
      error: 'error.html',
    }));
}


module.exports = doDeploy;
