
interface HighlightInfo {
    refid: string
    refurl: string
    note: string
    imageUrl: string
    updateat: number
    createat: number
    annonation: string
    color: string
    slotId: number
}

interface ExportConfig {
    logseqSplitTemplate: string
    logseqPageAddToJournals: number
    logseqPageNoteAsAttr: number
    logseqAnnoAsAttr: number
    logseqQuery: string
    lsqtt: string
    lsqat: string
    lsqht: string
    lsqant: string
}

interface ExportInitRequestResponse {
    lastCursor2: string
    totalNotes: number
    notesExported: number
    taskStatus: string
    exportConfig: ExportConfig
}

interface NoteEntry {
    noteIdX: string
    author: string
    title: string
    url: string
    wucaiurl: string
    readurl: string
    createAt: number
    updateAt: number
    pageNote: string
    isStar: boolean
    tags: Array<string>
    highlights: Array<HighlightInfo>
    citekey: string
}

interface ExportDownloadResponse {
    notes: Array<NoteEntry>
    lastCursor2: string
}

interface ResponseCheckRet {
    isOk: boolean
    msg: string
    errCode: number
}

interface AttrsItem {
    name: string
    value: string
    render: bool
}

interface WuCaiTemplates {
    TitleTemplate: AttrsItem
    AttrTemplate: Array<AttrsItem>
    HighlightTemplate: AttrsItem
    AnnoTemplate: AttrsItem
}