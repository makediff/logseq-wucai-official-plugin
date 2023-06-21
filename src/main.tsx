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
const SUCCESS_STATUSES = ['SYNCING']
const API_URL_INIT = '/apix/openapi/wucai/sync/init'
const API_URL_DOWNLOAD = '/apix/openapi/wucai/sync/download'
const API_URL_ACK = '/apix/openapi/wucai/sync/ack'

function getAuthHeaders(tk: string) {
  return {
    AUTHORIZATION: `Token ${tk}`,
    'Logseq-Client': `${getLogseqClientID()}`,
  }
}

function callApi(url: string, accessToken: any, params: any) {
  const reqtime = Math.floor(+new Date() / 1000)
  params['v'] = BGCONSTS.VERSION_NUM
  params['serviceId'] = BGCONSTS.SERVICE_ID
  url += `?appid=${BGCONSTS.APPID}&ep=${BGCONSTS.ENDPOINT}&version=${BGCONSTS.VERSION}&reqtime=${reqtime}`
  return fetch(BGCONSTS.BASE_URL + url, {
    headers: { ...getAuthHeaders(accessToken), 'Content-Type': 'application/json' },
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
    response = await callApi(url, '', { did: uuid })
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

function getNewEntryBlock(entry: NoteEntry, preferredDateFormat: string, exportConfig: ExportConfig): IBatchBlock {
  const tags = (entry.tags || []).join(' ')
  const createat = `${formatDate(entry.createAt, 'yyyy-MM-dd HH:mm')}`
  const updateat = `${formatDate(entry.updateAt, 'yyyy-MM-dd HH:mm')}`
  let prop = { noteid: entry.noteIdX, tags, createat, updateat, url: entry.url }
  const isHaveJournals = exportConfig.logseqPageAddToJournals === 1
  if (isHaveJournals) {
    const datex = `[[${formatDate(entry.createAt, preferredDateFormat)}]]`
    prop.date = datex
  }
  const isPageNoteAsAttr = exportConfig.logseqPageNoteAsAttr === 1
  if (isPageNoteAsAttr && entry.pageNote) {
    prop.note = WuCaiUtils.formatContent(entry.pageNote)
  }
  return {
    content: WuCaiUtils.formatTitle(entry.title) || 'No title',
    properties: prop,
  } as IBatchBlock
}

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
  errCode: number
}

// 对接口返回的内容进行检查
function checkResponseBody(rsp: any, setAccessToken?: any): ResponseCheckRet {
  let ret: ResponseCheckRet = { isOk: true, msg: '', errCode: 1 }
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
  ret.errCode = rsp.code
  if (10000 === errCode || 10100 === errCode || 10101 === errCode) {
    logseq.updateSettings({ wuCaiToken: '' })
    setAccessToken && setAccessToken('')
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
export async function exportInit(auto?: boolean, setNotification?, setIsSyncing?, setAccessToken?, accessToken?) {
  setNotification = setNotification || function (x: any) {}
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

  // @todo 因为有了网页拆分规则，就无法通过单个文件来判断是否需要重新同步，需要有新的机制
  const noteDirDeleted = false
  // const noteDirDeleted = (await logseq.Editor.getPage(BGCONSTS.ROOT_PAGE_NAME)) === null
  let lastCursor2 = logseq.settings?.lastCursor || ''
  let response
  let errmsg = ''
  try {
    // if (noteDirDeleted) {
    //   lastCursor2 = ''
    // }
    response = await callApi(API_URL_INIT, accessToken, { noteDirDeleted, lastCursor2 })
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
  const checkRet: ResponseCheckRet = checkResponseBody(data2, setAccessToken)
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

  // init values
  initRet.exportConfig = initRet.exportConfig || {}
  initRet.exportConfig.logseqSplitTemplate = initRet.exportConfig.logseqSplitTemplate || 'one'
  initRet.exportConfig.logseqPageAddToJournals = initRet.exportConfig.logseqPageAddToJournals || 1
  initRet.exportConfig.logseqPageNoteAsAttr = initRet.exportConfig.logseqPageNoteAsAttr || 2
  initRet.exportConfig.logseqAnnoAsAttr = initRet.exportConfig.logseqAnnoAsAttr || 2

  const df = (await logseq.App.getUserConfigs()).preferredDateFormat
  // step1~2: check update first, then sync data
  await downloadArchive(
    lastCursor,
    true,
    df,
    initRet.exportConfig,
    setNotification,
    setIsSyncing,
    setAccessToken,
    accessToken
  )
}

// @ts-ignore
async function downloadArchive(
  lastCursor2: string,
  checkUpdate: boolean,
  preferredDateFormat: string,
  exportConfig: ExportConfig,
  setNotification?: any,
  setIsSyncing?: any,
  setAccessToken?: any,
  accessToken?: any
): Promise<void> {
  let response
  let flagx = ''
  const writeStyle = 1
  let noteIdXs: Array<string> = []
  // logger({ msg: 'download', checkUpdate, flagx, lastCursor2 })
  try {
    response = await callApi(API_URL_DOWNLOAD, accessToken, {
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
    setNotification('request download api error 1')
    logger({ msg: 'req download api error 1', response })
    logseq.UI.showMsg(getErrorMessageFromResponse(response as Response), 'error')
    return
  }

  const data2 = await response.json()
  const checkRet: ResponseCheckRet = checkResponseBody(data2, setAccessToken)
  if (!checkRet.isOk) {
    setIsSyncing(false)
    setNotification('request download api error 2')
    logger({ msg: 'req download api error 2', checkRet })
    logseq.UI.showMsg(checkRet.msg, 'error')
    return
  }

  const downloadRet: ExportDownloadResponse = data2['data']
  const entries: Array<NoteEntry> = downloadRet.notes || []

  // 对网页所在的节点UUID进行缓存，以提升性能
  const cachedPageUUID = {}
  for (const entry of entries) {
    try {
      let parentName = WuCaiUtils.generatePageName(exportConfig.logseqSplitTemplate, entry.createAt)
      let parentUUID = cachedPageUUID[parentName] || ''
      if (!parentUUID) {
        // 检查页面是否创建，如果没有则创建
        let tmpEntry = await logseq.Editor.getPage(parentName)
        if (!tmpEntry) {
          tmpEntry = await logseq.Editor.createPage(parentName)
          if (!tmpEntry) {
            // create page error
            continue
          }
        }
        parentUUID = tmpEntry.uuid
        cachedPageUUID[parentName] = parentUUID
        logger({ msg: 'create new node', parentName, parentUUID })
      } else {
        logger({ msg: 'use cache node', parentName, parentUUID })
      }

      const noteIdX = entry.noteIdX
      let webpageBlock = await getWebPageBlockByNoteIdX(parentName, noteIdX)
      if (!webpageBlock) {
        const tmpBlock = getNewEntryBlock(entry, preferredDateFormat, exportConfig)
        if (!tmpBlock) {
          continue
        }
        // logger({ msg: 'prepare insert webpage', parentUUID, cnt: tmpBlock.content })
        webpageBlock = await logseq.Editor.insertBlock(parentUUID, tmpBlock.content, {
          sibling: false,
          properties: tmpBlock.properties,
        })
        if (!webpageBlock) {
          console.log({ msg: 'entryBlock not found' })
          continue
        }
      }

      entry.highlights = entry.highlights || []

      if (entry.pageNote) {
        const pageNoteCore = WuCaiUtils.formatContent(entry.pageNote)
        const isPageNoteAsAttr = exportConfig.logseqPageNoteAsAttr === 1
        if (isPageNoteAsAttr) {
          webpageBlock.properties = webpageBlock.properties || {}
          const oldNoteProp = webpageBlock.properties['note']
          if (oldNoteProp != pageNoteCore) {
            await logseq.Editor.upsertBlockProperty(webpageBlock.uuid, 'note', pageNoteCore)
          }
        } else {
          // 如果页面笔记不作为block的属性，则和划线列表同级别
          entry.highlights.unshift({
            note: pageNoteCore,
          } as HighlightInfo)
        }
      }

      const highParentUUID = webpageBlock.uuid
      const isAnnoAsAttr = exportConfig.logseqAnnoAsAttr === 1
      for (const light of entry.highlights) {
        let noteCore
        if (light.imageUrl) {
          noteCore = `![](${light.imageUrl})`
        } else {
          noteCore = WuCaiUtils.formatContent(light.note)
        }
        let highBlock = await getHighlightBlockBy(highParentUUID, noteCore)
        if (!highBlock) {
          highBlock = (await logseq.Editor.insertBlock(highParentUUID, noteCore, { sibling: false })) || undefined
          if (!highBlock) {
            continue
          }
        }
        if (light.annonation) {
          const annoCore = WuCaiUtils.formatContent(light.annonation)
          if (isAnnoAsAttr) {
            highBlock.properties = highBlock.properties || {}
            const oldNoteProp = highBlock.properties['note']
            if (oldNoteProp != annoCore) {
              await logseq.Editor.upsertBlockProperty(highBlock.uuid, 'note', annoCore)
            }
          } else {
            let annoBlock = await getHighlightBlockBy(highBlock.uuid, annoCore)
            if (!annoBlock) {
              await logseq.Editor.insertBlock(highBlock.uuid, annoCore)
            }
          }
        }
      }
    } catch (e2) {
      logger({ msg: 'process entry error', entry, e2 })
      setNotification && setNotification('process highlight error')
    }
  }

  const isEmpty = entries.length <= 0
  const isCompleted = !checkUpdate && isEmpty
  const tmpLastCursor2 = getLastCursor(downloadRet.lastCursor2, lastCursor2)
  if (!tmpLastCursor2 || lastCursor2 == tmpLastCursor2) {
    setNotification && setNotification(null)
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  lastCursor2 = tmpLastCursor2
  logseq.updateSettings({ lastCursor: lastCursor2 })

  if (isCompleted) {
    setIsSyncing && setIsSyncing(false)
    setNotification && setNotification(null)
    handleSyncSuccess('', lastCursor2)
    await acknowledgeSyncCompleted(accessToken)
    logseq.UI.showMsg('WuCai Hightlights sync completed')
    return
  }

  await new Promise((r) => setTimeout(r, 5000))
  const isBeginSyncData = checkUpdate && isEmpty
  await downloadArchive(
    lastCursor2,
    !isBeginSyncData,
    preferredDateFormat,
    exportConfig,
    setNotification,
    setIsSyncing,
    setAccessToken,
    accessToken
  )
  logger({ msg: 'continue download', checkUpdate, lastCursor2 })
}

async function acknowledgeSyncCompleted(accessToken?: any) {
  try {
    const lastCursor2 = logseq.settings?.lastCursor
    callApi(API_URL_ACK, accessToken, { lastCursor2 })
  } catch (e) {
    logger({ msg: 'fetch failed to acknowledged sync: ', e })
  }
}

function configureSchedule() {
  checkForCurrentGraph()
  // 23.6.4 引擎同步会引起卡顿，目前暂停自动同步
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
  console.info({ msg: 'wucai loaded', pluginId })
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
    [class*='wucai-'] {
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
