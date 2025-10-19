import React from 'react'
import { createRoot } from 'react-dom/client'
import Feed from './app/Feed'
import UploadsPage from './app/Uploads'
import PublishPage from './app/Publish'
import ProductionsPage from './app/Productions'

const root = createRoot(document.getElementById('root')!)

const path = window.location.pathname
let Component = Feed
if (path.startsWith('/uploads')) {
  Component = UploadsPage
} else if (path.startsWith('/productions')) {
  Component = ProductionsPage
} else if (path.startsWith('/publish')) {
  Component = PublishPage
}

root.render(<Component />)
