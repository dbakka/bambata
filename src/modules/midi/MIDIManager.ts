import { parseMIDIAction, parseMIDIMessageType } from './DDJMapping'
import type { MIDIAction } from './DDJMapping'
import type { MIDIMessage, MIDIDevice } from '../../types'

type MessageCallback = (msg: MIDIMessage) => void
type ActionCallback = (action: MIDIAction) => void
type DeviceCallback = (devices: MIDIDevice[]) => void

export class MIDIManager {
  private static instance: MIDIManager | null = null

  private access: MIDIAccess | null = null
  private messageCallbacks: Set<MessageCallback> = new Set()
  private actionCallbacks: Set<ActionCallback> = new Set()
  private deviceCallbacks: Set<DeviceCallback> = new Set()
  private msgCounter = 0

  static getInstance(): MIDIManager {
    if (!MIDIManager.instance) {
      MIDIManager.instance = new MIDIManager()
    }
    return MIDIManager.instance
  }

  get isSupported(): boolean {
    return 'requestMIDIAccess' in navigator
  }

  async connect(): Promise<MIDIDevice[]> {
    if (!this.isSupported) return []

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.access.onstatechange = () => this.rebindInputs()
      this.rebindInputs()
      return this.getDevices()
    } catch (err) {
      console.warn('MIDI access denied:', err)
      return []
    }
  }

  private rebindInputs() {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => this.handleMessage(event, input.name ?? 'Unknown')
    }
    const devices = this.getDevices()
    this.deviceCallbacks.forEach((cb) => cb(devices))
  }

  private handleMessage(event: MIDIMessageEvent, deviceName: string) {
    const data = event.data
    if (!data || data.length < 2) return

    const statusByte = data[0]
    const data1 = data[1] ?? 0
    const data2 = data[2] ?? 0
    const channel = (statusByte & 0x0F) + 1
    const typeStr = parseMIDIMessageType(statusByte)

    const msg: MIDIMessage = {
      id: `m${this.msgCounter++}`,
      timestamp: event.timeStamp,
      deviceName,
      statusByte,
      data1,
      data2,
      type: typeStr,
      channel,
      value: data2,
    }

    if ((statusByte & 0xF0) === 0x90 || (statusByte & 0xF0) === 0x80) {
      msg.note = data1
    } else if ((statusByte & 0xF0) === 0xB0) {
      msg.cc = data1
    }

    this.messageCallbacks.forEach((cb) => cb(msg))

    const action = parseMIDIAction(statusByte, data1, data2)
    if (action) {
      this.actionCallbacks.forEach((cb) => cb(action))
    }
  }

  getDevices(): MIDIDevice[] {
    if (!this.access) return []
    const devices: MIDIDevice[] = []
    for (const input of this.access.inputs.values()) {
      devices.push({
        id: input.id,
        name: input.name ?? 'Unknown',
        manufacturer: input.manufacturer ?? '',
        connected: input.state === 'connected',
      })
    }
    return devices
  }

  onMessage(cb: MessageCallback): () => void {
    this.messageCallbacks.add(cb)
    return () => this.messageCallbacks.delete(cb)
  }

  onAction(cb: ActionCallback): () => void {
    this.actionCallbacks.add(cb)
    return () => this.actionCallbacks.delete(cb)
  }

  onDeviceChange(cb: DeviceCallback): () => void {
    this.deviceCallbacks.add(cb)
    return () => this.deviceCallbacks.delete(cb)
  }
}
