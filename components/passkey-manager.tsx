'use client'

import { useState, useEffect, useCallback } from 'react'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import toast from 'react-hot-toast'

interface Passkey {
  id: string
  name: string
  deviceType: string | null
  createdAt: string
}

export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [newPasskeyName, setNewPasskeyName] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)
  const [supportsPasskeys, setSupportsPasskeys] = useState(false)

  // Check browser support
  useEffect(() => {
    setSupportsPasskeys(browserSupportsWebAuthn())
  }, [])

  // Fetch passkeys
  const fetchPasskeys = useCallback(async () => {
    try {
      const res = await fetch('/api/passkey/list')
      if (res.ok) {
        const data = await res.json()
        setPasskeys(data.passkeys)
      }
    } catch (error) {
      console.error('Failed to fetch passkeys:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPasskeys()
  }, [fetchPasskeys])

  // Register a new passkey
  const handleRegister = async () => {
    if (!supportsPasskeys) {
      toast.error('Your browser does not support passkeys')
      return
    }

    setIsRegistering(true)

    try {
      // Get registration options
      const optionsRes = await fetch('/api/passkey/register-options', {
        method: 'POST',
      })

      if (!optionsRes.ok) {
        throw new Error('Failed to get registration options')
      }

      const options = await optionsRes.json()

      // Prompt user to create passkey
      const regResponse = await startRegistration({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch('/api/passkey/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: regResponse,
          name: newPasskeyName || 'Passkey',
        }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Registration failed')
      }

      toast.success('Passkey registered successfully')
      setNewPasskeyName('')
      setShowNameInput(false)
      fetchPasskeys()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register passkey'
      if (!message.includes('cancelled') && !message.includes('abort')) {
        toast.error(message)
      }
    } finally {
      setIsRegistering(false)
    }
  }

  // Delete a passkey
  const handleDelete = async (passkeyId: string, passkeyName: string) => {
    if (!confirm(`Delete passkey "${passkeyName}"?`)) {
      return
    }

    try {
      const res = await fetch('/api/passkey/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkeyId }),
      })

      if (!res.ok) {
        throw new Error('Failed to delete passkey')
      }

      toast.success('Passkey deleted')
      fetchPasskeys()
    } catch {
      toast.error('Failed to delete passkey')
    }
  }

  if (!supportsPasskeys) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          Your browser does not support passkeys.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Passkeys</h3>
          <p className="text-sm text-muted-foreground">
            Sign in securely without a password using Face ID, Touch ID, or a security key.
          </p>
        </div>
      </div>

      {/* Passkey list */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
        ) : (
          passkeys.map((pk) => (
            <div
              key={pk.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5Z" />
                    <path d="M12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium">{pk.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pk.deviceType === 'singleDevice' ? 'Security Key' : 'Platform Authenticator'}
                    {' · '}
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(pk.id, pk.name)}
              >
                Delete
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Add passkey */}
      {showNameInput ? (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="passkey-name">Passkey name (optional)</Label>
            <Input
              id="passkey-name"
              placeholder="e.g., MacBook Pro"
              value={newPasskeyName}
              onChange={(e) => setNewPasskeyName(e.target.value)}
              disabled={isRegistering}
            />
          </div>
          <Button onClick={handleRegister} disabled={isRegistering}>
            {isRegistering ? 'Registering...' : 'Continue'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setShowNameInput(false)
              setNewPasskeyName('')
            }}
            disabled={isRegistering}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowNameInput(true)}
          disabled={isRegistering}
        >
          <svg
            className="mr-2 h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a passkey
        </Button>
      )}
    </div>
  )
}
