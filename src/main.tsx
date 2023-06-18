import '@logseq/libs'
import 'virtual:windi.css'

import React from 'react'
import App from './App'
import { BGCONSTS } from './bgconsts'
import { format } from 'date-fns'
import { IBatchBlock, PageEntity, SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'
import { BlockEntity, BlockUUID, PageIdentity } from '@logseq/libs/dist/LSPlugin.user'
import { WuCaiUtils } from './utils'
import { el } from 'date-fns/locale'

interface HighlightInfo {
  note: string
  imageUrl: string
  updateAt: number
  annonation: string
  color: string
  slotId: number
}

interface ExportConfig {
  logseqSplitTemplate: string
  logseqPageAddToJournals: number
  logseqPageNoteAsAttr: number
  logseqAnnoAsAttr: number
}

interface ExportInitRequestResponse {
  lastCursor2: string
  totalNotes: number
  notesExported: number
  taskStatus: string
  exportConfig: ExportConfig
}

interface NoteEntry {
  title: string
  url: string
  noteIdX: string
  noteId: number
  wuCaiUrl: string
  createAt: number
  updateAt: number
  pageNote: string
  category: string
  tags: Array<string>
  highlights: Array<HighlightInfo>
  citekey: string
  author: string
}

interface ExportDownloadResponse {
  notes: Array<NoteEntry>
  lastCursor2: string
}

// @ts-expect-error
const css = (t, ...args) => String.raw(t, ...args)
const TriggerIconName = 'wucai-icon'
// const WAITING_STATUSES = ['PENDING', 'RECEIVED', 'STARTED', 'RETRY']
const SUCCESS_STATUSES = ['SYNCING']
const API_URL_INIT = '/apix/openapi/wucai/sync/init'
const API_URL_DOWNLOAD = '/apix/openapi/wucai/sync/download'
const API_URL_ACK = '/apix/openapi/wucai/sync/ack'
// const WRITE_STYLE_OVERWRITE = 1
// const WRITE_STYLE_APPEND = 2

function getAuthHeaders() {
  return {
    AUTHORIZATION: `Token ${logseq.settings!.wuCaiToken}`,
    'Logseq-Client': `${getLogseqClientID()}`,
  }
}

function callApi(url: string, params: any) {
  const reqtime = Math.floor(+new Date() / 1000)
  params['v'] = BGCONSTS.VERSION_NUM
  params['serviceId'] = BGCONSTS.SERVICE_ID
  url += `?appid=${BGCONSTS.APPID}&ep=${BGCONSTS.ENDPOINT}&version=${BGCONSTS.VERSION}&reqtime=${reqtime}`
  return fetch(BGCONSTS.BASE_URL + url, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    method: 'POST',
    body: JSON.stringify(params),
  })
}

function getLogseqClientID() {
  let cid = window.localStorage.getItem('wc-LogseqClientId')
  if (cid) {
    return cid
  }
  cid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  window.localStorage.setItem('wc-LogseqClientId', cid)
  return cid
}

// @ts-ignore
export async function getUserAuthToken(attempt = 0) {
  const uuid = getLogseqClientID()
  if (attempt === 0) {
    window.open(`${BGCONSTS.BASE_URL}/page/gentoken/${BGCONSTS.SERVICE_ID}/${uuid}`)
  }
  await new Promise((r) => setTimeout(r, 2000)) // wait until have data on cache
  let response, data
  try {
    let url = '/page/auth/openapi/gettoken'
    response = await callApi(url, { did: uuid })
  } catch (e) {
    console.log('WuCai Official plugin: fetch failed in getUserAuthToken: ', e)
  }
  if (response && response.ok) {
    data = await response.json()
  } else {
    console.log('WuCai Official plugin: bad response in getUserAuthToken: ', response)
    logseq.UI.showMsg('Authorization failed. Try again', 'warning')
    return
  }
  if (data.code === 1 && data.data.accessToken) {
    return data.data.accessToken
  }
  if (attempt > 20) {
    console.log('WuCai Official plugin: reached attempt limit in getUserAuthToken')
    return
  }
  console.log(`WuCai Official plugin: didn't get token data, retrying (attempt ${attempt + 1})`)
  await new Promise((r) => setTimeout(r, 1000))
  return await getUserAuthToken(attempt + 1)
}

function formatDate(ts: number, preferredDateFormat: string): string {
  return format(new Date(ts * 1000), preferredDateFormat)
}

// function detectCodeQuote(cnt: string): string {
//   // 用来检测内容是否有代码引用，如果有，并且还没有闭合，则补全，是logseq的一个bug
//   if (!cnt || cnt.length <= 0) {
//     return ''
//   }
//   return cnt.replace(/^\s+|\s+$/, '')
// }

function getNewEntryBlock(entry: NoteEntry, preferredDateFormat: string, exportConfig: ExportConfig): IBatchBlock {
  const isHaveJournals = exportConfig.logseqPageAddToJournals === 1
  const tags = (entry.tags || []).join(' ')
  const createat = `${formatDate(entry.createAt, 'yyyy-MM-dd HH:mm')}`
  const updateat = `${formatDate(entry.updateAt, 'yyyy-MM-dd HH:mm')}`
  let prop = { noteid: entry.noteIdX, tags, createat, updateat, url: entry.url }
  if (isHaveJournals) {
    const datex = `[[${formatDate(entry.createAt, preferredDateFormat)}]]`
    prop.date = datex
  }
  if (exportConfig.logseqPageNoteAsAttr === 1) {
    if (entry.pageNote && entry.pageNote.length > 0) {
      prop['笔记'] = WuCaiUtils.formatContent(entry.pageNote)
    }
  }
  return {
    content: WuCaiUtils.formatTitle(entry.title) || 'No title',
    properties: prop,
  } as IBatchBlock
}

// function getBlocksFromEntry(entry: NoteEntry, preferredDateFormat: string): Array<IBatchBlock> {
//   if (!entry) {
//     return []
//   }
//   entry.tags = entry.tags || []
//   const tags = (entry.tags || []).join(' ')
//   const datex = `[[${formatDate(entry.createAt, preferredDateFormat)}]]`
//   const createat = `${formatDate(entry.createAt, 'yyyy-MM-dd HH:mm')}`
//   const updateat = `${formatDate(entry.updateAt, 'yyyy-MM-dd HH:mm')}`
//   const block: IBatchBlock = {
//     content: WuCaiUtils.formatTitle(entry.title) || 'No title',
//     properties: { noteid: entry.noteIdX, date: datex, tags, createat, updateat, url: entry.url },
//     children: [],
//   }

//   if (entry.pageNote) {
//     block.children?.push({
//       content: WuCaiUtils.formatTitle(entry.pageNote),
//     } as IBatchBlock)
//   }
//   if (!entry.highlights || entry.highlights.length <= 0) {
//     return [block]
//   }
//   entry.highlights.forEach((light) => {
//     let subEntry: IBatchBlock = {
//       content: light.imageUrl ? `![](${light.imageUrl})` : light.note,
//       children: [],
//     }
//     if (light.annonation) {
//       subEntry.children?.push({ content: WuCaiUtils.formatTitle(light.annonation) })
//     }
//     block.children?.push(subEntry)
//   })
//   return [block]
// }

// async function updatePage(parentBlock: PageIdentity, blocks: Array<IBatchBlock>, sibling: boolean = false) {
//   if (!parentBlock) {
//     return
//   }
//   await new Promise((r) => setTimeout(r, 500))
//   return await logseq.Editor.insertBatchBlock(parentBlock, blocks, { sibling })
// }

function handleSyncError(cb: () => void) {
  logseq.updateSettings({
    lastSyncFailed: true,
  })
  cb()
}

export function clearSettingsComplete() {
  logseq.updateSettings({
    lastSyncFailed: false,
    lastCursor: '',
    wuCaiToken: null,
    isLoadAuto: true,
    currentGraph: null,
  })
}

interface ResponseCheckRet {
  isOk: boolean
  msg: string
}
// 对接口返回的内容进行检查
function checkResponseBody(rsp: any): ResponseCheckRet {
  let ret: ResponseCheckRet = { isOk: true, msg: '' }
  if (!rsp) {
    ret.isOk = false
    ret.msg = 'WuCai: call api failed'
    return ret
  }
  if (rsp && 1 === rsp.code) {
    ret.isOk = true
    ret.msg = ''
    return ret
  }
  let errCode = rsp.code
  ret.isOk = false
  if (10000 === errCode || 10100 === errCode || 10101 === errCode) {
    logseq.updateSettings({ wuCaiToken: '' })
  }
  let err = localize(rsp['message'] || 'call api failed')
  err = `WuCai: ${errCode} ${err}`
  ret.msg = err
  return ret
}

function getErrorMessageFromResponse(response: Response) {
  if (response && response.status === 409) {
    return 'Sync in progress initiated by different client'
  }
  if (response && response.status === 417) {
    return 'Obsidian export is locked. Wait for an hour.'
  }
  return `${response ? response.statusText : "Can't connect to server"}`
}

// 获取划线所在的block
async function getHighlightBlockBy(parentBlockId: string, highlight: string): Promise<BlockEntity | undefined> {
  /**
   * 如果 block 产生了 ref，会改变 content，所以需要用 includes 来判断
   */
  const blocks = (
    await logseq.DB.datascriptQuery<BlockEntity[]>(
      `[:find (pull ?b [*])
        :where
          [?b :block/parent ?parent]
          [?parent :block/uuid ?u]
          [(str ?u) ?s]
          [(= ?s "${parentBlockId}")]
          [?b :block/content ?c]
          [(clojure.string/includes? ?c "${WuCaiUtils.escapeQuotes(highlight)}")]
      ]`
    )
  ).flat()
  return blocks[0]
}

// 找出页面所在的block
async function getWebPageBlockByNoteIdX(pageName: string, noteIdX: string): Promise<BlockEntity | null> {
  const blocks = (
    await logseq.DB.datascriptQuery<BlockEntity[]>(
      `[:find (pull ?b [*])
        :where
          [?b :block/page ?p]
          [?p :block/original-name "${WuCaiUtils.escapeQuotes(pageName)}"]
          [?b :block/properties ?prop]
          [(get ?prop :noteid) ?noteid]
          [(= ?noteid "${WuCaiUtils.escapeQuotes(noteIdX)}")]]`
    )
  ).flat()
  return blocks[0] || null
}

function handleSyncSuccess(msg = 'Synced', lastCursor: string = '') {
  logseq.updateSettings({
    lastSyncFailed: false,
  })
  if (lastCursor) {
    logseq.updateSettings({ lastCursor })
  }
  if (msg && msg.length > 0) {
    logseq.UI.showMsg(msg)
  }
}

function getLastCursor(newCursor: string, savedCursor: string): string {
  return newCursor || savedCursor || ''
}

// @ts-ignore
export async function exportInit(auto?: boolean, setNotification?, setIsSyncing?) {
  // @ts-ignore
  if (window.onAnotherGraph) {
    setIsSyncing(false)
    setNotification(null)
    handleSyncError(() => {
      const msg = `Graph changed during sync, please return to graph "${
        logseq.settings!.currentGraph.name
      }" to complete the sync`
      if (!auto) {
        logseq.UI.showMsg(msg, 'error')
      } else {
        logger(msg)
      }
    })
    return
  }

  setNotification('Starting wuCai sync...')

  if (auto) {
    await new Promise((r) => setTimeout(r, 2000))
  }

  const noteDirDeleted = (await logseq.Editor.getPage(BGCONSTS.ROOT_PAGE_NAME)) === null
  let lastCursor2 = logseq.settings?.lastCursor || ''
  let response
  let errmsg = ''
  try {
    if (noteDirDeleted) {
      lastCursor2 = ''
    }
    response = await callApi(API_URL_INIT, { noteDirDeleted, lastCursor2 })
  } catch (e) {
    errmsg = 'req export init error'
    logger({ errmsg, e })
  }
  if (!response || !response.ok) {
    setIsSyncing(false)
    setNotification(errmsg)
    logseq.UI.showMsg(errmsg, 'error')
    return
  }

  const data2 = await response.json()
  const checkRet: ResponseCheckRet = checkResponseBody(data2)
  if (!checkRet.isOk) {
    setIsSyncing(false)
    setNotification(checkRet.msg)
    logseq.UI.showMsg(checkRet.msg, 'error')
    return
  }

  const initRet: ExportInitRequestResponse = data2['data']
  const lastCursor = getLastCursor(initRet.lastCursor2, lastCursor2)
  logseq.updateSettings({ lastCursor })

  // 错误的状态
  if (!SUCCESS_STATUSES.includes(initRet.taskStatus)) {
    handleSyncSuccess()
    logseq.UI.showMsg('WuCai data is already up to date')
    setIsSyncing(false)
    setNotification(null)
    return
  }

  // step1~2: check update first, then sync data
  // let rootPage: PageEntity = await logseq.Editor.getPage(BGCONSTS.ROOT_PAGE_NAME)
  // if (!rootPage) {
  //   rootPage = await logseq.Editor.createPage(
  //     BGCONSTS.ROOT_PAGE_NAME,
  //     {},
  //     {
  //       createFirstBlock: false,
  //       redirect: false,
  //     }
  //   )
  // }
  // if (!rootPage) {
  //   return
  // }

  // init values
  initRet.exportConfig = initRet.exportConfig || {}
  initRet.exportConfig.logseqSplitTemplate = initRet.exportConfig.logseqSplitTemplate || 'allinone'
  initRet.exportConfig.logseqPageAddToJournals = initRet.exportConfig.logseqPageAddToJournals || 1
  initRet.exportConfig.logseqPageNoteAsAttr = initRet.exportConfig.logseqPageNoteAsAttr || 2
  initRet.exportConfig.logseqAnnoAsAttr = initRet.exportConfig.logseqAnnoAsAttr || 2

  const preferredDateFormat = (await logseq.App.getUserConfigs()).preferredDateFormat
  await downloadArchive(lastCursor, true, preferredDateFormat, initRet.exportConfig, setNotification, setIsSyncing)
}

// async function getPageOrCreate(pageName: string): PageEntity | null {
//   if (!pageName || pageName.length <= 0) {
//     return null
//   }
//   let entry: PageEntity | null = await logseq.Editor.getPage(pageName)
//   if (entry) {
//     return entry
//   }
//   return await logseq.Editor.createPage(
//     pageName,
//     {},
//     {
//       createFirstBlock: false,
//       redirect: false,
//     }
//   )
// }

// @ts-ignore
async function downloadArchive(
  lastCursor2: string,
  checkUpdate: boolean,
  preferredDateFormat: string,
  exportConfig: ExportConfig,
  setNotification?,
  setIsSyncing?
): Promise<void> {
  let response
  let flagx = ''
  const writeStyle = 1
  let noteIdXs: Array<string> = []
  // logger({ msg: 'download', checkUpdate, flagx, lastCursor2 })
  try {
    response = await callApi(API_URL_DOWNLOAD, {
      lastCursor2,
      noteIdXs,
      flagx,
      writeStyle,
      out: BGCONSTS.OUT,
      checkUpdate,
    })
  } catch (e) {
    logger(['fetch failed in downloadArchive: ', e])
    setIsSyncing(false)
  }
  if (!response || !response.ok) {
    setIsSyncing(false)
    setNotification(null)
    logger({ msg: 'req download api error', response })
    logseq.UI.showMsg(getErrorMessageFromResponse(response as Response), 'error')
    return
  }

  const data2 = await response.json()
  const checkRet: ResponseCheckRet = checkResponseBody(data2)
  if (!checkRet.isOk) {
    setIsSyncing(false)
    setNotification(null)
    logger({ msg: 'req download api error 2', checkRet })
    logseq.UI.showMsg(checkRet.msg, 'error')
    return
  }

  const downloadRet: ExportDownloadResponse = data2['data']
  const entries: Array<NoteEntry> = downloadRet.notes || []

  // 如果是同步到单页，则先建立好父节点，避免每次创建
  let parentEntry
  let parentUUID
  let parentName = BGCONSTS.ROOT_PAGE_NAME
  let isAllInOne = exportConfig.logseqSplitTemplate === 'allinone'
  if (isAllInOne) {
    parentEntry = await logseq.Editor.getPage(parentName)
    if (!parentEntry) {
      parentEntry = await logseq.Editor.createPage(parentName)
    }
    if (!parentEntry) {
      setIsSyncing && setIsSyncing(false)
      setNotification && setNotification(null)
      logger({ msg: 'create page error', parentName })
      logseq.UI.showMsg('创建页面错误 1', 'error')
      return
    }
    parentUUID = parentEntry.uuid
  }

  const cachedPageUUID = {}
  for (const entry of entries) {
    try {
      if (!isAllInOne) {
        parentName = WuCaiUtils.generatePageName(exportConfig.logseqSplitTemplate, entry.createAt)
        // 检查页面是否创建，如果没有则创建
        parentEntry = await logseq.Editor.getPage(parentName)
        if (!parentEntry) {
          parentEntry = await logseq.Editor.createPage(parentName)
        }
        if (!parentEntry) {
          // create page error
          continue
        }
        parentUUID = parentEntry.uuid
        cachedPageUUID[parentName] = parentEntry.uuid
      }
      const noteIdX = entry.noteIdX
      let webpageBlock = await getWebPageBlockByNoteIdX(parentName, noteIdX)
      if (!webpageBlock) {
        // create a new block for this webpage

        const tmpBlock = getNewEntryBlock(entry, preferredDateFormat, exportConfig)
        if (!tmpBlock) {
          continue
        }
        logger({ msg: 'prepare insert webpage', parentUUID, cnt: tmpBlock.content })
        webpageBlock = await logseq.Editor.insertBlock(parentUUID, tmpBlock.content, {
          sibling: false,
          properties: tmpBlock.properties,
        })
      }
      if (!webpageBlock) {
        console.log({ msg: 'entryBlock not found' })
        continue
      }

      entry.highlights = entry.highlights || []
      if (exportConfig.logseqPageNoteAsAttr !== 1) {
        // 如果页面笔记不作为block的属性，则和划线列表同级别
        if (entry.pageNote && entry.pageNote.length > 0) {
          entry.highlights.unshift({
            note: entry.pageNote,
          } as HighlightInfo)
        }
      }

      const highParentUUID = webpageBlock.uuid
      const highlights = entry.highlights || []
      for (let light of highlights) {
        let noteCore
        if (light.imageUrl && light.imageUrl.length > 0) {
          noteCore = `![](${light.imageUrl})`
        } else {
          noteCore = WuCaiUtils.formatContent(light.note)
        }
        let highBlock = await getHighlightBlockBy(highParentUUID, noteCore)
        if (!highBlock) {
          console.log({ msg: 'highBlock not found', highBlock, noteCore })
          highBlock = (await logseq.Editor.insertBlock(highParentUUID, noteCore, { sibling: false })) || undefined
        }
        if (!highBlock) {
          continue
        }
        if (light.annonation && light.annonation.length > 0) {
          const annoCore = WuCaiUtils.formatContent(light.annonation)
          let annoBlock = await getHighlightBlockBy(highBlock.uuid, annoCore)
          if (!annoBlock) {
            await logseq.Editor.insertBlock(highBlock.uuid, annoCore)
          }
        }
      }
    } catch (e2) {
      logger({ msg: 'process entry error', entry, e2 })
    }
  }

  if (!checkUpdate) {
    console.log({ v2: 3 })
    setIsSyncing && setIsSyncing(false)
    return
  }

  const isEmpty = entries.length <= 0
  const isCompleted = !checkUpdate && isEmpty
  const tmpLastCursor2 = getLastCursor(downloadRet.lastCursor2, lastCursor2)
  if (!tmpLastCursor2 || lastCursor2 == tmpLastCursor2) {
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  lastCursor2 = tmpLastCursor2
  logseq.updateSettings({ lastCursor: lastCursor2 })

  if (isCompleted) {
    setIsSyncing && setIsSyncing(false)
    setNotification && setNotification(null)
    handleSyncSuccess('', lastCursor2)
    await acknowledgeSyncCompleted()
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  await new Promise((r) => setTimeout(r, 5000))
  const isBeginSyncData = checkUpdate && isEmpty
  await downloadArchive(
    lastCursor2,
    !isBeginSyncData,
    preferredDateFormat,
    setNotification,
    setIsSyncing
  )
  logger({ msg: 'continue download', checkUpdate, lastCursor2 })
}

async function acknowledgeSyncCompleted() {
  try {
    const lastCursor2 = logseq.settings?.lastCursor
    callApi(API_URL_ACK, { lastCursor2 })
  } catch (e) {
    logger({ msg: 'fetch failed to acknowledged sync: ', e })
  }
}

function configureSchedule() {
  // 23.6.4 引擎同步会引起卡顿，目前暂停自动同步
  // checkForCurrentGraph()
  // // @ts-ignore
  // const onAnotherGraph = window.onAnotherGraph
  // if (logseq.settings!.wuCaiToken && logseq.settings!.frequency) {
  //   if (logseq.settings!.frequency === 'Never') {
  //     return
  //   }
  //   if (!onAnotherGraph) {
  //     const frequency = parseInt(logseq.settings!.frequency)
  //     if (!isNaN(frequency) && frequency > 0) {
  //       const milliseconds = frequency * 60 * 1000
  //       // eslint-disable-next-line @typescript-eslint/no-empty-function
  //       window.setInterval(
  //         () => exportInit(true, console.log, () => {}).then(() => console.log('Auto sync loaded.')),
  //         milliseconds
  //       )
  //     } else {
  //       logseq.updateSettings({
  //         frequency: '180',
  //       })
  //     }
  //   }
  // }
}

function logger(msg: any) {
  BGCONSTS.IS_DEBUG && console.log(msg)
}

function localize(msg: string): string {
  return msg
}

export function checkForCurrentGraph() {
  window.logseq.App.getCurrentGraph().then((currentGraph) => {
    // @ts-ignore
    window.onAnotherGraph = !!(logseq.settings!.currentGraph && currentGraph?.url !== logseq.settings!.currentGraph.url)
  })
}

function main() {
  const schema: Array<SettingSchemaDesc> = [
    {
      key: 'isLoadAuto',
      type: 'boolean',
      default: false,
      title: 'Sync automatically when Logseq opens',
      description: 'If enabled, WuCai will automatically resync with Logseq each time you open the app',
    },
    {
      key: 'frequency',
      type: 'enum',
      enumChoices: ['Never'],
      enumPicker: 'select',
      default: 'Never',
      title: 'Resync frequency',
      description:
        'WuCai will automatically resync with Logseq when the app is open at the specified interval (in minutes)',
    },
  ]
  logseq.useSettingsSchema(schema)
  const pluginId = logseq.baseInfo.id
  console.info(`#${pluginId}: MAIN`)
  const container = document.getElementById('app')
  const root = createRoot(container!)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

  function createModel() {
    return {
      async show() {
        logseq.showMainUI()
      },
    }
  }

  logseq.provideModel(createModel())
  logseq.setMainUIInlineStyle({
    zIndex: 11,
  })

  logseq.provideStyle(css`
    @font-face {
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }

    [class^='wucai-'],
    [class*=' wucai-'] {
      speak: never;
      font-style: normal;
      font-weight: normal;
      font-variant: normal;
      text-transform: none;
      line-height: 1;
      -webkit-font-smoothing: antialiased;
    }

    .${TriggerIconName} {
      font-size: 12px;
    }

    .${TriggerIconName}:before {
      content: '彩';
    }
  `)

  logseq.App.registerUIItem('toolbar', {
    key: 'wucai-plugin-open',
    template: `
          <a data-on-click="show" title="WuCai" class="button">
            <span class="${TriggerIconName}"></span>
          </a>
        `,
  })
  checkForCurrentGraph()
  window.logseq.App.onCurrentGraphChanged(() => {
    checkForCurrentGraph()
  })
  configureSchedule()
}

logseq.ready(main).catch(console.error)
