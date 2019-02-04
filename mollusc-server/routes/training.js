const {createReadStream, stat} = require('fs')
const {Router} = require('express')

module.exports = function trainingRoute(server) {
  const {engineManager, baseUrl, trafMiddleware, log} = server
  const app = new Router()

  function sessionMiddleware(req, resp, next) {
    const id = req.params.id
    const trainingInstance = (id === 'latest')
      ? engineManager.listTrainingInstances().pop()
      : engineManager.getTrainingInstanceById(id)
    // console.log({id, trainingInstance})
    if (!trainingInstance)
      return resp.status(404).send("No such session")
    const {session} = trainingInstance
    Object.assign(req, {session, instance: trainingInstance})
    next()
  }

  function sendSession(req, resp) {
    const {session} = req
    resp.set('Content-Type', 'application/json')
    resp.set('Location', `${baseUrl}/training/${session.id}`)
    resp.send(session)
  }

  app.get('/:id', sessionMiddleware, (req, resp) => {
    return sendSession(req, resp)
  })

  app.get('/:id/checkpoint', sessionMiddleware, (req, resp) => {
    const {checkpoints} = req.session
    resp.set('Content-Type', 'application/json')
    const urls = checkpoints.map(([dt, {path}], idx) => {
      return `${baseUrl}/training/${req.session.id}/checkpoint/${idx}`
    })
    resp.send(urls)
  })

  app.get('/:id/checkpoint/:idx', sessionMiddleware, (req, resp) => {
    const checkpoint = req.session.checkpoints[req.params.idx]
    if (!checkpoint) {
      return resp.status(404).send("Checkpoint not found")
    }
    const [dt, {mediaType, path}] = checkpoint
    resp.set('Content-Type', mediaType)
    resp.set('Date', dt)
    stat(path, (err, {size}) => {
      resp.set('Content-Length', size)
      const instream = createReadStream(path)
      instream.pipe(resp)
    })
  })

  app.post('/:id/save', sessionMiddleware, (req, resp, next) => {
    const {instance} = req
    instance._saveSession()
    return resp.send('Saved')
  })

  app.put('/:id/:command(start|pause|resume|stop)', sessionMiddleware, (req, resp) => {
    const {command} = req.params
    log.debug(`Running ${command}() on session ${req.params.id}`)
    req.instance[command]()
    return sendSession(req, resp)
  })

  app.post('/', trafMiddleware, (req, resp) => {
    try {
      const {session} = engineManager.createTrainingSession(req.body)
      req.session = session
      return sendSession(req, resp)
    } catch (error) {
      console.log(error)
      log.warn(error)
      resp.status(400)
      resp.send({message: "Invalid config", error})
    }
  })

  app.get('/', (req, resp) => {
    const sessions = engineManager.listTrainingInstances().map(instance => instance.session)
    if (req.query.full == '1') {
      resp.send(sessions)
    } else  {
      resp.send(sessions.map(session => `${baseUrl}/training/${session.id}`))
    }
  })


  return app
}