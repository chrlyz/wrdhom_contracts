import {
  Field,
  SmartContract,
  state,
  State,
  method,
  MerkleMap,
  UInt32,
} from 'snarkyjs';
import { PostsRollupProof } from './Posts';

export const usersTree = new MerkleMap();
export const usersRoot = usersTree.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) users = State<Field>();
  @state(Field) postsNumber = State<Field>();

  init() {
    super.init();
    this.users.set(usersRoot);
    this.postsNumber.set(Field(0));
  }

  @method update(rollupProof: PostsRollupProof) {
    rollupProof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(rollupProof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(rollupProof.publicInput.blockHeight.add(Field(1)))
    );

    const currentState = this.users.getAndAssertEquals();
    rollupProof.publicInput.initialUsersRoot.assertEquals(currentState);

    const currentPostsNumber = this.postsNumber.getAndAssertEquals();
    rollupProof.publicInput.initialPostsNumber.assertEquals(currentPostsNumber);

    this.users.set(rollupProof.publicInput.latestUsersRoot);
    this.postsNumber.set(rollupProof.publicInput.latestPostsNumber);
  }
}
