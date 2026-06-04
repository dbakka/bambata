import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { getDeviceId } from '../utils/deviceId'

export function usePartySocket(partyId: string): Socket {
  const socketRef = useRef<Socket | null>(null)

  if (!socketRef.current) {
    socketRef.current = io({ autoConnect: false })
  }

  useEffect(() => {
    const socket = socketRef.current!
    socket.connect()
    socket.emit('join:party', partyId)

    return () => {
      socket.disconnect()
    }
  }, [partyId])

  return socketRef.current
}

export function useCreatorSocket(partyId: string, creatorToken: string): Socket {
  const socketRef = useRef<Socket | null>(null)

  if (!socketRef.current) {
    socketRef.current = io({ autoConnect: false })
  }

  useEffect(() => {
    const socket = socketRef.current!
    socket.connect()
    socket.emit('join:creator', { partyId, creatorToken, deviceId: getDeviceId() })

    return () => {
      socket.disconnect()
    }
  }, [partyId, creatorToken])

  return socketRef.current
}
