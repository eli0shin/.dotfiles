return {
  'goropikari/plantuml.nvim',
  lazy = true,
  cmd = 'PlantumlPreview',
  opts = {
    -- default opts
    base_url = 'https://www.plantuml.com/plantuml',
    reload_events = { 'BufWritePre' },
    viewer = 'xdg-open', -- Image viewer for non-ASCII exports
    docker_image = 'plantuml/plantuml-server:tomcat',
  },
}
