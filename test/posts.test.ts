import { describe, expect, test } from 'bun:test'
import { extractExcerptHtml, shiftHeadingsHtml } from '../src/lib/posts'

describe('shiftHeadingsHtml', () => {
  test('shifts heading tags while preserving attributes', () => {
    expect(shiftHeadingsHtml('<h2 id="intro">Intro</h2><h4>Next</h4>', 2)).toBe(
      '<h4 id="intro">Intro</h4><h6>Next</h6>'
    )
  })

  test('clamps headings at h6', () => {
    expect(shiftHeadingsHtml('<h5>Five</h5><h6>Six</h6>', 3)).toBe(
      '<h6>Five</h6><h6>Six</h6>'
    )
  })

  test('does not change heading-like markup inside pre or code blocks', () => {
    const html = '<h2>Real</h2><pre><code><h2>Example</h2></code></pre><code><h3>Inline</h3></code>'
    expect(shiftHeadingsHtml(html, 2)).toBe(
      '<h4>Real</h4><pre><code><h2>Example</h2></code></pre><code><h3>Inline</h3></code>'
    )
  })

  test('leaves HTML unchanged for a zero or negative offset', () => {
    const html = '<h2>Heading</h2>'
    expect(shiftHeadingsHtml(html, 0)).toBe(html)
    expect(shiftHeadingsHtml(html, -2)).toBe(html)
  })
})

describe('extractExcerptHtml', () => {
  test('uses the explicit excerpt marker and detects following content', () => {
    expect(extractExcerptHtml('<p>Intro</p><!-- excerpt --><p>More</p>')).toEqual({
      html: '<p>Intro</p>',
      hasMore: true,
    })
    expect(extractExcerptHtml('<p>Intro</p><!-- excerpt -->  \n')).toEqual({
      html: '<p>Intro</p>',
      hasMore: false,
    })
  })

  test('includes up to two top-level paragraphs and marks remaining content', () => {
    const html = '<p>First</p>\n<p>Second <strong>paragraph</strong></p>\n<p>Third</p>'
    expect(extractExcerptHtml(html)).toEqual({
      html: '<p>First</p>\n<p>Second <strong>paragraph</strong></p>',
      hasMore: true,
    })
  })

  test('preserves leading media and nested blocks without cutting inside their markup', () => {
    const media = '<figure><img src="/one.png"><figcaption>One</figcaption></figure>\n'
    const component = '<vod-player camera="front"><div>Player</div></vod-player>\n'
    const quote = '<blockquote><p>Nested paragraph</p><p>Still nested</p></blockquote>\n'
    const html = `${media}${component}<p>First paragraph</p>\n<p>Second paragraph</p>\n${quote}<p>Third</p>`
    const result = extractExcerptHtml(html)

    expect(result.hasMore).toBe(true)
    expect(result.html).toBe(`${media}${component}<p>First paragraph</p>\n<p>Second paragraph</p>`)
    expect(result.html).not.toContain('<blockquote>')
    expect(result.html).not.toContain('<figcaption>One</figcaption></figure></figure>')
  })

  test('does not show a read-more state when there are at most two paragraphs', () => {
    const html = '<p>One</p>\n<p>Two</p>'
    expect(extractExcerptHtml(html)).toEqual({ html, hasMore: false })
    expect(extractExcerptHtml('<p>Only one</p>')).toEqual({
      html: '<p>Only one</p>',
      hasMore: false,
    })
  })

  test('reports trailing blocks after the paragraph limit as more content', () => {
    const html = '<p>One</p><p>Two</p><figure><img src="/after.png"></figure>'
    expect(extractExcerptHtml(html)).toEqual({
      html: '<p>One</p><p>Two</p>',
      hasMore: true,
    })
  })
})
