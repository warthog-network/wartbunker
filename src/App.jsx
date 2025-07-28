import { useState } from 'react'

import WebWallet from './pages/Wallet.jsx'
import './App.css'


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <h1>Welcome to wart bunker, where we make self-custody of your wart the priority on the front lines</h1>
     <WebWallet />
    </>
  )
}

export default App
