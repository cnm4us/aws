import React from 'react'
import { createRoot } from 'react-dom/client'
import Feed from './app/Feed'

const root = createRoot(document.getElementById('root')!)
root.render(<Feed />)
