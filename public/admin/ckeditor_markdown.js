;(function () {
  function ensureLoaded() {
    return typeof window.ClassicEditor !== 'undefined' && typeof window.TurndownService !== 'undefined'
  }

  function createTurndown() {
    var svc = new window.TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    })

    // Keep blank lines reasonable.
    var orig = svc.turndown.bind(svc)
    svc.turndown = function (input) {
      var md = orig(input)
      md = md.replace(/\r\n/g, '\n')
      md = md.replace(/\n{4,}/g, '\n\n\n')
      return md.trim() + '\n'
    }

    return svc
  }

  function initEditors() {
    if (!ensureLoaded()) return
    var turndown = createTurndown()
    var textareas = document.querySelectorAll('textarea[data-md-wysiwyg="1"]')
    if (!textareas || !textareas.length) return

    var editors = []
    for (var i = 0; i < textareas.length; i++) {
      ;(function () {
        var ta = textareas[i]
        if (ta.getAttribute('data-md-wysiwyg-init') === '1') return
        ta.setAttribute('data-md-wysiwyg-init', '1')

        var wrapper = document.createElement('div')
        wrapper.className = 'md-wysiwyg'
        var label = ta.closest && ta.closest('label')
        if (label && label.contains(ta) && label.parentNode) {
          // If the textarea is inside a <label>, inserting the editor into the label can cause
          // clicks/focus to hit the toolbar (often opening dropdowns). Insert after the label.
          label.parentNode.insertBefore(wrapper, label.nextSibling)
        } else {
          ta.parentNode.insertBefore(wrapper, ta)
        }

        // The textarea remains the form source-of-truth.
        ta.style.display = 'none'

        window.ClassicEditor.create(wrapper, {
          toolbar: {
            items: [
              'heading',
              '|',
              'bold',
              'italic',
              'link',
              '|',
              'bulletedList',
              'numberedList',
              'blockQuote',
              '|',
              'undo',
              'redo',
            ],
          },
          heading: {
            options: [
              { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
              { model: 'heading1', view: 'h1', title: 'Heading 1', class: 'ck-heading_heading1' },
              { model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
              { model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' },
            ],
          },
        })
          .then(function (editor) {
            try {
              var initHtml = ta.getAttribute('data-md-initial-html') || ''
              if (initHtml) {
                editor.setData(initHtml)
              } else if (ta.value && ta.value.trim()) {
                // Best-effort: show existing markdown as plain text.
                // After first save, the field will normalize through HTML→Markdown conversion.
                editor.setData('<p>' + escapeHtml(String(ta.value || '')).replace(/\n/g, '<br/>') + '</p>')
              } else {
                editor.setData('')
              }
            } catch {}

            var entry = { textarea: ta, editor: editor, dirty: false }
            try {
              editor.model.document.on('change:data', function () {
                entry.dirty = true
              })
            } catch {}
            editors.push(entry)
          })
          .catch(function (err) {
            console.error('ckeditor init failed', err)
            ta.style.display = ''
            wrapper.parentNode.removeChild(wrapper)
          })
      })()
    }

    var forms = new Set()
    for (var j = 0; j < textareas.length; j++) {
      var f = textareas[j].form
      if (f) forms.add(f)
    }

    forms.forEach(function (form) {
      form.addEventListener('submit', function () {
        for (var k = 0; k < editors.length; k++) {
          var entry = editors[k]
          if (entry.textarea.form !== form) continue
          if (!entry.dirty) continue
          try {
            var html = entry.editor.getData()
            entry.textarea.value = turndown.turndown(html)
          } catch (e) {
            console.error('markdown conversion failed', e)
          }
        }
      })
    })
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 0)
    } else {
      document.addEventListener('DOMContentLoaded', fn)
    }
  }

  ready(initEditors)
})()
