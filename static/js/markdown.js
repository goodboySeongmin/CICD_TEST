(function(){
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  function render(md){
    if (!md) return '';
    let text = String(md);
    const blocks = [];
    text = text.replace(/```([\s\S]*?)```/g, function(_, code){
      const idx = blocks.length; blocks.push('<pre><code>'+escapeHtml(code)+'</code></pre>');
      return '§§BLOCK'+idx+'§§';
    });
    text = escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/^######\s?(.*)$/gm, '<h6>$1</h6>')
               .replace(/^#####\s?(.*)$/gm, '<h5>$1</h5>')
               .replace(/^####\s?(.*)$/gm, '<h4>$1</h4>')
               .replace(/^###\s?(.*)$/gm, '<h3>$1</h3>')
               .replace(/^##\s?(.*)$/gm, '<h2>$1</h2>')
               .replace(/^#\s?(.*)$/gm, '<h1>$1</h1>');
    text = text.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>[^<]*<\/li>\n?)+/g, function(m){ return '<ul>'+m.replace(/\n/g,'')+'</ul>'; });
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/§§BLOCK(\d+)§§/g, function(_, i){ return blocks[+i]||''; });
    return text;
  }

  window.QMarkdown = { render };
})();

