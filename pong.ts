import { interval, fromEvent, merge } from 'rxjs'
import { map, filter, scan } from 'rxjs/operators'

/**
 * Main function called to run the Pong game.
 */
function pong() {
  /**
   * This class is used as a helper class to perform coordinate geometry calculations.
   * All defined functions within this class are pure, in the sense that there are no
   * forms of mutation to internal state and side effects to passed in arguments.
   * 
   * Adapted from Tim's Observable Asteroid's Notes: https://tgdwyer.github.io/asteroids/ 
   */
  class Vector {
    constructor(public readonly x: number = 0, public readonly y: number = 0) {}
    add = (b: Vector) => new Vector(this.x + b.x, this.y + b.y)
    sub = (b: Vector) => this.add(b.scale(-1))
    len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
    scale = (s:number) => new Vector(this.x*s,this.y*s)
    ortho = ()=> new Vector(this.y,-this.x)
    static Zero = new Vector();
  }

  /**
   * This class is used as a helper class to help generate a random number in the range [-1, 1] based
   * on a particular seed value.
   * This class provides pure functions in the sense that we would always produce the same number
   * relative to the passed in seed.
   * 
   * Adapted from Tutorial 4, Exercise 5: https://lms.monash.edu/mod/resource/view.php?id=7335187
   */
  class RNG {
    // LCG using GCC's constants
    m = 0x80000000// 2**31
    a = 1103515245
    c = 12345
    state:number
    constructor(seed: number) {
      this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
    }
    nextInt() {
      this.state = (this.a * this.state + this.c) % this.m;
      return this.state;
    }
    nextFloat() {
      // returns in range [0,1]
      return this.nextInt() / (this.m - 1);
    }
  }

  /**
   * These constants are used to maintain extensibility and readability of code.
   */
  const 
    CANVAS_WIDTH: number = 600,
    CANVAS_HEIGHT: number = 600,
    PADDLE_WIDTH: number = 10,
    PADDLE_HEIGHT: number = 80,
    RIGHT_PADDLE_START_POSITION: Vector = new Vector(580, 260),
    LEFT_PADDLE_START_POSITION: Vector = new Vector(10, 260),
    BALL_RADIUS: number = 6,
    BALL_CENTRE: Vector = new Vector(CANVAS_WIDTH / 2 , CANVAS_HEIGHT / 2),
    DEFAULT_BALL_VELOCITY: Vector = new Vector(2.5, -3.5),
    MAX_ANGLE: number = 2 * Math.PI / 9,  // 80 degrees
    FINAL_SCORE: number = 7,
    FRP: number = 1000/70,
    RANDOM_GENERATED_NUMBER: RNG = new RNG(20);  // an instance of the Random Number Generator with a specific seed

  /**
   * This type defines the key codes accepted from KeyboardEvents by this Pong game.
   */
  type Key = 'w' | 's' | 'r';

  /**
   * This type defines the attributes of a paddles.
   * Keeps track of the paddle states.
   */
  type Paddle = Readonly<{
    id: string
    position: Vector
    width: number
    height: number
  }>

  /**
   * This type defines the attributes of a ball. 
   * Keeps track of the ball states.
   */
  type Ball = Readonly<{
      id: string
      position: Vector
      radius: number
      velocity: Vector
  }>

  /**
   * This type defines the various components presented within this game.
   * Keeps track of entire game state.
   */
  type GameState = Readonly<{
    rightPaddle: Paddle
    leftPaddle: Paddle
    userScore: number
    oppScore: number
    ball: Ball
    gameOver: boolean
  }>

  /**
   * This class is used to identify events pushed from Observables to move the ball.
   */
  class BallMovement { constructor() {
    // This comment is to surpress SonarLint issue
  } }

  /**
   * This class is used to identify events pushed from Observables to move the paddle.
   */
  class PaddleMovement { constructor(public readonly move: Vector) {} }
  
  /**
   * This class is used to identify events pushed from Observables to move the computer controlled paddle.
   */
  class CompPaddleMovement { constructor() {
    // This comment is to surpress SonarLint issue
  } }

  /**
   * This function is used to set the attributes of Elements in the canvas based on a certain set of
   * attributes defined in an object.
   * This is an impure function in the sense that it causes side effects onto the HTML page's elements
   * by mutating it's attributes.
   * 
   * Adapted from Tim's Observable Asteroid's Notes: https://tgdwyer.github.io/asteroids/
   */
  const attr = (e: Element, o: Object) => { for(const k in o) e.setAttribute(k,String(o[k])) };

  /**
    * This function is used to retrieve the element by id.
  */
  const getElementId = (id: string) => document.getElementById(id);

  /**
   * This function is used to create a new game ball on start and also get the game ball in the event
   * a restart is done. It initializes the attributes of the ball.
   * This is an impure function in the sense that it causes side effects onto the HTML page's elements
   * by mutating it's attributes.
   */
  function createBall(): Ball {
    const newBall = () => {
      const 
        canvas = getElementId("canvas"), 
        b = getElementId("ball") || document.createElementNS(canvas.namespaceURI, "circle");
      
        attr(b, {id: "ball", cx: BALL_CENTRE.x, cy: BALL_CENTRE.y, r: BALL_RADIUS, fill: "white"});  
        canvas.appendChild(b);
      
      return <Ball> {
        id: b.getAttribute("id"),
        position: new Vector(BALL_CENTRE.x, BALL_CENTRE.y),
        radius: BALL_RADIUS,
        velocity: DEFAULT_BALL_VELOCITY
      }
    }
    return newBall();
  }

  const 
    /**
     * This function is used as a generic function to observe specific key presses.
     * This is a pure function in the sense that we do not mutate internal states but rather return 
     * new objects with updated values, preventing side-effects.
     * 
     * Adapted from Tim's Observable Asteroid's Notes: https://tgdwyer.github.io/asteroids/
     */
    keyObservable = <T>(e:string, k:Key, result:() => T) =>
      fromEvent<KeyboardEvent>(document,e)
          .pipe(
            filter(({key})=>key === k),
            // filter(({repeat})=>!repeat),
            map(result)),
    
    /**
     * This function is used as a generic function to specify a certain interval for observables to 
     * be fired and later mapped to a specific value.
     * This is a pure function in the sense that we do not mutate internal states but rather return 
     * new objects with updated values, preventing side-effects.
     */
    intervals = <T>(i: number, f: () => T) => interval(i).pipe(map(_ => f())),
    
    /**
     * This function is used to provide a vector to allow movement of a paddle.
     * This is a pure function in the sense that we do not mutate internal states but rather return 
     * new objects with updated values, preventing side-effects. Besides that, we will always
     * obtain the same output for the same input values.
     */
    animatePaddle = (y: number) => () => new PaddleMovement(new Vector(0, y)),
    
    /**
     * This is a pure function used to create a paddle and map it to a paddle state object.
     */
    createPaddle = (id: string) => (v: Vector) => (<Paddle>{ id: id, position: v, width: PADDLE_WIDTH, height: PADDLE_HEIGHT }),

    /**
     * This function is used to move a paddle by a certain vector amount.
     * This is a pure function in the sense that we do not mutate internal states but rather return 
     * new objects with updated values, preventing side-effects.
     */
    reducePaddleState = (m: Paddle) => (p: PaddleMovement): Paddle => {
      const
        movePaddle = (v1: Vector) => (v2: Vector) => v1.add(v2), 
        outOfBorder = (paddle: Paddle) => (d: PaddleMovement) => {
          const position = movePaddle(paddle.position)(d.move).y;
          return (position < 0) || (position + paddle.height > CANVAS_HEIGHT);
        }

      return createPaddle(m.id)(outOfBorder(m)(p) ? m.position : movePaddle(m.position)(p.move))
    },

    /**
     * This function is used to move the computer paddle.
     * This is a pure function in the sense that we do not mutate internal states but rather return 
     * new objects with updated values, preventing nasty side-effects.
     * The computer controlled paddle will always follow the ball's position at any given point in time.
     */
    reduceAiPaddleState = (s: GameState) => {
      const
        quarterOfPaddleHeight: number = PADDLE_HEIGHT / 4,
        yDisplacement = s.ball.position.sub(s.leftPaddle.position).y - quarterOfPaddleHeight,
        paddleMovement = new PaddleMovement(new Vector(0, yDisplacement))

      return <GameState>{...s,
        leftPaddle: reducePaddleState(s.leftPaddle)(paddleMovement)
      }
    }

  /**
   * This function is used to update the current game state.
   * This is a pure function in the sense that we do not mutate internal states but rather return 
   * new objects with updated values, preventing nasty side-effects.
   */
  function reduceState(acc: GameState, m: BallMovement | PaddleMovement | CompPaddleMovement) {
    if (m instanceof PaddleMovement) {
      return {...acc,
        rightPaddle: reducePaddleState(acc.rightPaddle)(m)
      };
    } else if (m instanceof CompPaddleMovement) {
      return reduceAiPaddleState(acc);
    } else if (m instanceof BallMovement) {
      return handleBallCollisions(acc);
    } else {
      return {...acc};
    }
  }

  /**
   * This function is used to handle the collisions of the ball.
   */
  function handleBallCollisions(s: GameState) {
    const
      ballXInterval: number[] = [s.ball.position.x - s.ball.radius, s.ball.position.x + s.ball.radius],
      ballYInterval: number[] = [s.ball.position.y - s.ball.radius, s.ball.position.y + s.ball.radius],
      canvasXInterval: number[] = [BALL_RADIUS, CANVAS_WIDTH - BALL_RADIUS],
      canvasYInterval: number[] = [BALL_RADIUS, CANVAS_HEIGHT - BALL_RADIUS]

    const
      /**
       * This is a pure generic function used to help the collision detection process.
       * 
       * Adapted from Workshop 2 Activity: https://edstem.org/courses/4439/workspaces/p8ygHgh7xfGeVGKV27RthKykrCDmwIQ2
       */
      overlappingIntervals = <T>([x1, x2]: T[]) => ([x3, x4]: T[]) => !(x2 < x3 || x4 < x1),
      
      /**
       * This is a pure generic function used to detect if a polygon has gone out of a certain boundary.
       */
      wallCollision = <T>(f: (u: T, v: T) => boolean) => ([x1, x2]: T[]) => ([x3, x4]: T[]) => 
                      f(x1, x3) && !overlappingIntervals([x1, x2])([x3, x4]),
      
      /**
       * This function is used to detect if the game ball collides with a paddle.
       * This is an impure function because of it's dependence on the current ball's position.
       */
      paddleCollision = (p: Paddle): boolean => {
        const
          rectXInterval: number[] = [p.position.x, p.position.x + p.width],
          rectYInterval: number[] = [p.position.y, p.position.y + p.height]
        
        return overlappingIntervals(ballXInterval)(rectXInterval) && 
                overlappingIntervals(ballYInterval)(rectYInterval);
      },
      
      collideTopCanvas = wallCollision((y1: number, y2: number)=> y1 < y2)(ballYInterval)(canvasYInterval),
      collideBottomCanvas = wallCollision((y1: number, y2: number)=> y1 >= y2)(ballYInterval)(canvasYInterval),
      collideLeftCanvas = wallCollision((x1: number, x2: number)=> x1 < x2)(ballXInterval)(canvasXInterval),
      collideRightCanvas = wallCollision((x1: number, x2: number)=> x1 >= x2)(ballXInterval)(canvasXInterval),
      userCollision = paddleCollision(s.rightPaddle),
      oppCollision = paddleCollision(s.leftPaddle);
    
    const
      /**
       * This is a pure function used to invert the Y component of a vector.
       */
      invertY = (d: Vector) => new Vector(d.x, -1 * d.y),

      /**
       * This is a pure function used to perform an initial transformation of a vector before adding onto 
       * another vector.
       */
      move = (f: (v: Vector) => Vector) => (p: Vector) => (d: Vector) => p.add(f(d)),

      /**
       * This is a pure generic function used to perform an operation between 2 data values.
       */
      binaryOperation = <T, U>(f: (x: T, y: U) => T | U) => (x: T) => (y: U) => f(x, y),

      /**
       * This is a pure function used to perform an 'or' operation between 2 boolean values.
       */
      orBinaryOperation = binaryOperation((x: boolean, y: boolean) => x || y),

      leftOrRightCanvasCollision = orBinaryOperation(collideLeftCanvas)(collideRightCanvas),
      topOrBottomCanvasCollision = orBinaryOperation(collideTopCanvas)(collideBottomCanvas),
      leftOrRightPaddleCollision = orBinaryOperation(userCollision)(oppCollision),

      /**
       * This is an impure function that returns a -1 or 1.
       * This function makes use of lazy evaluation, i.e. compute the return values upon pull.
       */
      generatePositiveOrNegativeOne = (): number => {
        // return a random number in the range [-1,1]
        const nextRandom = () => RANDOM_GENERATED_NUMBER.nextFloat()*2 - 1;
        return nextRandom() < 0 ? -1 : 1
      },
      
      /**
       * This function is used to manipulate the velocity of the game ball after colliding with
       * a paddle.
       * This is an impure function because of the use of a random number generator.
       * 
       * Drew inspiration/idea from this game: https://gamedev.stackexchange.com/questions/4253/in-pong-how-do-you-calculate-the-balls-direction-when-it-bounces-off-the-paddl/4255#4255
       */
      changeVelocity = (p: Paddle, b: Ball): Vector => {
        const
          ratio: number = (b.position.y - (p.position.y + p.height/2)) / (p.height/2),  // based on relative distance of 2 points
          reflectiveAngle: number = ratio * MAX_ANGLE,
          xDirection: number = b.position.x > (CANVAS_WIDTH / 2) ? -1 : 1,
          yDirection = generatePositiveOrNegativeOne(),  // random y direction
          resultant = Math.sqrt(Math.pow(b.velocity.x, 2) + Math.pow(b.velocity.y, 2)),
          x: number = xDirection * resultant * Math.cos(reflectiveAngle),
          y: number = yDirection * resultant * Math.sin(reflectiveAngle);
        return new Vector(x, y);
      },

      calculateVelocity = changeVelocity((userCollision ? s.rightPaddle : s.leftPaddle), s.ball),
      
      /**
       * This function is used to determine the final position of the ball.
       * This function makes use of lazy evaluation, i.e. compute the return values upon pull.
       */
      newPosition = (): Vector => {
        if (topOrBottomCanvasCollision) {
          return move(invertY)(s.ball.position)(s.ball.velocity);
        } else if (leftOrRightPaddleCollision) {
          return move(v => v)(s.ball.position)(calculateVelocity);
        } else {
          return move(v => v)(s.ball.position)(s.ball.velocity);
        }
      },
      
      /**
       * This function is used to determine the final velocity of the ball.
       * This function makes use of lazy evaluation, i.e. compute the return values upon pull.
       */
      newVelocity = (): Vector => {
        if (topOrBottomCanvasCollision) {
          return invertY(s.ball.velocity);
        } else if (leftOrRightPaddleCollision) {
          return calculateVelocity;
        } else {
          return s.ball.velocity;
        }
      },
      
      /**
       * This function is used to update the current game score.
       * This is an impure function due to the random number generator used, i.e. the returned value
       * may not be the same always for a similar given input.
       */
      reduceScore = (gs: GameState) => {
        const
          userScore: number = gs.userScore,
          oppScore: number = gs.oppScore,
          
          /**
           * This is a pure function used to determine if the game is over.
           */
          gameOver = () => gs.userScore === FINAL_SCORE || gs.oppScore === FINAL_SCORE,

          /**
           * This function is used to reset the paddle's position after scoring.
           */
          resetPaddlePositionAfterScoring = (p: Paddle) => (d: Vector) => 
                                            leftOrRightCanvasCollision ? d : p.position;
    
        return <GameState>{...gs,
          rightPaddle: {...gs.rightPaddle,
            position: resetPaddlePositionAfterScoring(gs.rightPaddle)(RIGHT_PADDLE_START_POSITION)
          },
          leftPaddle: {...gs.leftPaddle,
            position:  resetPaddlePositionAfterScoring(gs.leftPaddle)(LEFT_PADDLE_START_POSITION)
          },
          ball: {...gs.ball,
            position: leftOrRightCanvasCollision ? 
                        new Vector(CANVAS_WIDTH / 2, (CANVAS_HEIGHT / 2)) :  // restart from middle
                        gs.ball.position,
            velocity: collideLeftCanvas ? 
                        new Vector(-DEFAULT_BALL_VELOCITY.x, 
                          generatePositiveOrNegativeOne() * DEFAULT_BALL_VELOCITY.y) :
                      collideRightCanvas ?
                        new Vector(DEFAULT_BALL_VELOCITY.x, 
                          generatePositiveOrNegativeOne() * DEFAULT_BALL_VELOCITY.y) :
                        gs.ball.velocity
          },
          userScore: collideLeftCanvas ? userScore + 1 : userScore,
          oppScore: collideRightCanvas ? oppScore + 1 : oppScore,
          gameOver: gameOver() ? true : gs.gameOver
        }
      }
    return reduceScore(<GameState>{...s,
      ball: <Ball>{...s.ball,
        position: newPosition(),
        velocity: newVelocity()
      }
    })
  }

  /**
   * Observable streams (FRP).
   */
  const 
    keyDown$ = keyObservable("keydown", "w", animatePaddle(-10)),
    keyUp$ = keyObservable("keydown", "s", animatePaddle(10)),
    ballMove$ = intervals(FRP, () => new BallMovement()),
    leftPaddle$ = intervals(FRP, () => new CompPaddleMovement());
  
  /**
   * Initial state of the game.
   */
  const initialState: GameState = <GameState> {
    rightPaddle: createPaddle("rightPaddle")(RIGHT_PADDLE_START_POSITION),
    leftPaddle: createPaddle("leftPaddle")(LEFT_PADDLE_START_POSITION),
    userScore: 0,
    oppScore: 0,
    ball: createBall(),
    gameOver: false      
  };
  
  
  /**
   * The main observable subscription (FRP).
   */
  const gameSubscription =
    merge(keyUp$, keyDown$, ballMove$, leftPaddle$)
      .pipe(
        scan(reduceState, initialState)
      ).subscribe(updateView);

  /**
   * This function is used to update the game view (web).
   * 
   * This is an impure function as it mutates the HTML document element's attributes.
   * e.g. update the scores and update both the ball and paddle's current positions.
   * Tried using a few Array type functions to abstract away the implementation details (i.e. tried
   * to make it more functional).
  */
  function updateView(s: GameState) {
    const 
      getStateElements = (e: Element) => (id: string) => s[e.getAttribute(id)],
      ballId = getElementId(s.ball.id),
      paddlesId = [s.rightPaddle.id, s.leftPaddle.id].map(getElementId),
      scoresId = ["userScore", "oppScore"].map(getElementId)

    attr(ballId, {cx: `${s.ball.position.x}`, cy: `${s.ball.position.y}`});  // update ball position
    paddlesId.forEach((e) => attr(e, {y: `${getStateElements(e)("id").position.y}`}));  // update paddles position
    scoresId.forEach((e) => e.textContent=`${getStateElements(e)("id")}`);  // update scores

    if (s.gameOver) {
      gameSubscription.unsubscribe();
      determineWinner(s);
    }
  }

  /**
   * This function is used to determine the winner of the game and display the winner message.
   * This is an impure function as it mutates the HTML document's elements, causing side effects.
   * Tried using a few Array type functions to abstract away the implementation details (i.e. tried
   * to make it more functional).
   */
  function determineWinner(s: GameState) {
    const 
      canvas = getElementId("canvas"),
      v = document.createElementNS(canvas.namespaceURI, "text"), 
      r = document.createElementNS(canvas.namespaceURI, "rect"),
      t = document.createElementNS(canvas.namespaceURI, "text"),
      objects: Element[] = [r, t, v],
      winner = () => s.userScore === FINAL_SCORE ? "You Win" : "Opponent Win";  // lazy evaluation
    
    attr(v,{x: "50%", y: "30%", class: "gameover", fill: "white", "font-size": "50px", 
            "text-anchor": "middle", "dominant-baseline": "middle"});
    attr(r, {x: 220, y: 400, width: 160, height: 40, class: "restart_rect", fill: "white"})
    attr(t, {x: "50%", y: "70%", class: "restart_mess", fill: "black",
            "text-anchor": "middle", "dominant-baseline": "middle"})
    
    v.textContent = winner();
    t.textContent = "Press r to restart";
    
    objects.forEach(o => canvas.appendChild(o));  // append to display (impure part)

    const restart = keyObservable("keydown", 'r', ()=>true)
                        .subscribe(_ => {
                          objects.forEach(o => canvas.removeChild(o));
                          restart.unsubscribe();
                          return pong();  // restart (recursion, might not be the most elegant of ways)
                        })
  }
}
  
  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      pong();
    }
