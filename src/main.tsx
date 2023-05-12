import '@logseq/libs'
import 'virtual:windi.css'

import React from 'react'
import App from './App'
import { BGCONSTS } from './bgconsts'
import { format } from 'date-fns'
import { IBatchBlock, PageEntity, SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'
import { BlockEntity, PageIdentity } from '@logseq/libs/dist/LSPlugin.user'

interface HighlightInfo {
  note: string
  imageUrl: string
  updateAt: number
  annonation: string
  color: string
  slotId: number
}

interface ExportInitRequestResponse {
  lastCursor2: string
  totalNotes: number
  notesExported: number
  taskStatus: string
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
const TriggerIconName = 'rw-icon'
const WAITING_STATUSES = ['PENDING', 'RECEIVED', 'STARTED', 'RETRY']
const SUCCESS_STATUSES = ['SYNCING']
const API_URL_INIT = '/apix/openapi/wucai/sync/init'
const API_URL_DOWNLOAD = '/apix/openapi/wucai/sync/download'
const API_URL_ACK = '/apix/openapi/wucai/sync/ack'
const WRITE_STYLE_OVERWRITE = 1
const WRITE_STYLE_APPEND = 2

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

function getBlocksFromEntry(entry: NoteEntry, preferredDateFormat: string): Array<IBatchBlock> {
  if (!entry) {
    return []
  }
  let dt = formatDate(entry.createAt, preferredDateFormat)
  const tags = (entry.tags || []).join(' ')
  const block: IBatchBlock = {
    content: entry.title || 'No title',
    properties: { noteid: entry.noteIdX },
    children: [
      {
        content: `${dt}, ${tags} #WuCai [原文](${entry.url})`,
      } as IBatchBlock,
    ],
  }
  if (entry.pageNote) {
    block.children?.push({
      content: entry.pageNote,
    } as IBatchBlock)
  }
  if (!entry.highlights || entry.highlights.length <= 0) {
    return [block]
  }
  entry.highlights.forEach((light) => {
    let subEntry: IBatchBlock = {
      content: light.imageUrl ? `![](${light.imageUrl})` : light.note,
      children: [],
    }
    if (light.annonation) {
      subEntry.children?.push({ content: light.annonation })
    }
    block.children?.push(subEntry)
  })
  return [block]
}

async function updatePage(blockEntity: PageIdentity, blocks: Array<IBatchBlock>) {
  if (!blockEntity) {
    return
  }
  await new Promise((r) => setTimeout(r, 500))
  return await logseq.Editor.insertBatchBlock(blockEntity, blocks, {
    sibling: true,
  })
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
    // 无效Token
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

  if (SUCCESS_STATUSES.includes(initRet.taskStatus)) {
    // step1~2: check update first, then sync data
    let rootPage: PageEntity = await logseq.Editor.getPage(BGCONSTS.ROOT_PAGE_NAME)
    if (!rootPage) {
      rootPage = await logseq.Editor.createPage(
        BGCONSTS.ROOT_PAGE_NAME,
        { title: BGCONSTS.ROOT_PAGE_NAME },
        {
          createFirstBlock: true,
          redirect: false,
        }
      )
      await logseq.Editor.insertBlock(
        rootPage.originalName,
        '此节点数据由五彩划线自动同步，请不要手动修改，防止内容被覆盖'
      )
    }
    if (!rootPage) {
      return
    }
    const rootBlocks: Array<BlockEntity> = await logseq.Editor.getPageBlocksTree(BGCONSTS.ROOT_PAGE_NAME)
    if (!rootBlocks || rootBlocks.length <= 0) {
      return
    }
    const firstBlockEntity = rootBlocks[0].uuid
    const noteUUIDMap: { [key: string]: string } = {}
    rootBlocks.forEach((blk) => {
      let noteidx = blk.properties?.noteidx
      if (noteidx) {
        noteUUIDMap[noteidx] = blk.uuid
      }
    })
    logger({ lastCursor, noteUUIDMap, firstBlockEntity })
    const preferredDateFormat = (await logseq.App.getUserConfigs()).preferredDateFormat
    await downloadArchive(
      lastCursor,
      true,
      noteUUIDMap,
      firstBlockEntity,
      preferredDateFormat,
      setNotification,
      setIsSyncing
    )
  } else {
    handleSyncSuccess()
    logseq.UI.showMsg('WuCai data is already up to date')
    setIsSyncing(false)
    setNotification(null)
  }
}

// @ts-ignore
async function downloadArchive(
  lastCursor2: string,
  checkUpdate: boolean,
  noteUUIDMap: { [key: string]: string },
  firstBlockEntity: PageIdentity,
  preferredDateFormat: string,
  setNotification?,
  setIsSyncing?
): Promise<void> {
  let response
  let flagx = ''
  let writeStyle = 1
  let noteIdXs: Array<string> = []
  logger({ msg: 'download', checkUpdate, flagx, lastCursor2 })
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
  for (const entry of entries) {
    const noteId: string = entry.noteIdX
    let pageId = noteUUIDMap[noteId]
    if (pageId) {
      await logseq.Editor.removeBlock(pageId)
      delete noteUUIDMap[noteId]
    }
    const blocks = getBlocksFromEntry(entry, preferredDateFormat)
    if (blocks && blocks.length > 0) {
      let updateRet = await updatePage(firstBlockEntity, blocks)
      if (updateRet && updateRet.length >= 1 && updateRet[0].uuid) {
        noteUUIDMap[noteId] = updateRet[0].uuid
      }
    }
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
    setIsSyncing(false)
    setNotification(null)
    handleSyncSuccess('', lastCursor2)
    await acknowledgeSyncCompleted()
    logseq.UI.showMsg('WuCai Hightlights sync completed')
  } else {
    await new Promise((r) => setTimeout(r, 5000))
    const isBeginSyncData = checkUpdate && isEmpty
    await downloadArchive(
      lastCursor2,
      !isBeginSyncData,
      noteUUIDMap,
      firstBlockEntity,
      preferredDateFormat,
      setNotification,
      setIsSyncing
    )
  }
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
  checkForCurrentGraph()
  // @ts-ignore
  const onAnotherGraph = window.onAnotherGraph
  if (logseq.settings!.wuCaiToken && logseq.settings!.frequency) {
    if (logseq.settings!.frequency === 'Never') {
      return
    }
    if (!onAnotherGraph) {
      const frequency = parseInt(logseq.settings!.frequency)
      if (!isNaN(frequency) && frequency > 0) {
        const milliseconds = frequency * 60 * 1000
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        window.setInterval(
          () => exportInit(true, console.log, () => {}).then(() => console.log('Auto sync loaded.')),
          milliseconds
        )
      } else {
        logseq.updateSettings({
          frequency: '180',
        })
      }
    }
  }
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
      default: true,
      title: 'Sync automatically when Logseq opens',
      description: 'If enabled, WuCai will automatically resync with Logseq each time you open the app',
    },
    {
      key: 'frequency',
      type: 'enum',
      enumChoices: ['60', '180', '360', 'Never'],
      enumPicker: 'select',
      default: '180',
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

    [class^='rw-'],
    [class*=' rw-'] {
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
