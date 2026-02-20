import { jsxRenderer } from 'hono/jsx-renderer'
import { raw } from 'hono/html'

const tailwindConfig = `
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          "esono-primary": "#1e3a5f",
          "esono-secondary": "#4a6fa5",
          "esono-accent": "#c9a962",
          "esono-success": "#059669",
          "esono-warning": "#d97706",
          "esono-danger": "#dc2626",
          "esono-info": "#0284c7"
        },
        fontFamily: {
          sans: ["Inter", "IBM Plex Sans", "Source Sans Pro", "ui-sans-serif", "system-ui"]
        }
      }
    }
  }
`

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ESONO | Investment Readiness</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Sans+Pro:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.tailwindcss.com"></script>
        {raw(`<script>${tailwindConfig}</script>`)}
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        <link href="/static/esono.css" rel="stylesheet" />
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="esono-body">{children}</body>
    </html>
  )
})
