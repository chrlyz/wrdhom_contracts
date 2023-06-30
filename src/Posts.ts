import {
  Field,
  MerkleMap,
  Struct,
  MerkleMapWitness,
  PublicKey,
  Signature,
  Poseidon,
  Experimental,
  Provable,
} from 'snarkyjs';

// ============================================================================

export class PostState extends Struct({
  postNumber: Field,
  blockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash([this.postNumber, this.blockHeight]);
  }
}

// ============================================================================

export const userPostsTree = new MerkleMap();
export const userPostsRoot = userPostsTree.getRoot();

export class RollupTransition extends Struct({
  initialUsersRoot: Field,
  latestUsersRoot: Field,
  initialPostsNumber: Field,
  latestPostsNumber: Field,
  blockHeight: Field,
}) {
  static createPostsTransition(
    signature: Signature,

    initialUsersRoot: Field,
    latestUsersRoot: Field,
    userAddress: PublicKey,
    userWitness: MerkleMapWitness,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    hashedPost: Field,
    postWitness: MerkleMapWitness,

    initialPostsNumber: Field,
    postState: PostState
  ) {
    const isSigned = signature.verify(userAddress, [hashedPost]);
    isSigned.assertTrue();

    const zeroIfNewUser = Provable.if(
      initialPostsRoot.equals(userPostsRoot),
      Field(0),
      initialPostsRoot
    );

    const [usersRootBefore, userKey] =
      userWitness.computeRootAndKey(zeroIfNewUser);
    initialUsersRoot.assertEquals(usersRootBefore);
    Poseidon.hash(userAddress.toFields()).assertEquals(userKey);

    const userPostsRootBefore = postWitness.computeRootAndKey(Field(0))[0];
    initialPostsRoot.assertEquals(userPostsRootBefore);

    initialPostsNumber.add(Field(1)).assertEquals(postState.postNumber);
    const userPostsRootAfter = postWitness.computeRootAndKey(
      postState.hash()
    )[0];
    userPostsRootAfter.assertEquals(latestPostsRoot);

    const usersRootAfter = userWitness.computeRootAndKey(latestPostsRoot)[0];
    usersRootAfter.assertEquals(latestUsersRoot);

    return new RollupTransition({
      initialUsersRoot: initialUsersRoot,
      latestUsersRoot: latestUsersRoot,
      initialPostsNumber: initialPostsNumber,
      latestPostsNumber: postState.postNumber,
      blockHeight: postState.blockHeight,
    });
  }

  static assertEquals(
    transition1: RollupTransition,
    transition2: RollupTransition
  ) {
    transition1.initialUsersRoot.assertEquals(transition2.initialUsersRoot);
    transition1.latestUsersRoot.assertEquals(transition2.latestUsersRoot);
    transition1.initialPostsNumber.assertEquals(transition2.initialPostsNumber);
    transition1.latestPostsNumber.assertEquals(transition2.latestPostsNumber);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }
}

// ============================================================================

export const PostsRollup = Experimental.ZkProgram({
  publicInput: RollupTransition,

  methods: {
    postsTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        PublicKey,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        PostState,
      ],

      method(
        transition: RollupTransition,
        signature: Signature,
        initialUsersRoot: Field,
        latestUsersRoot: Field,
        userAddress: PublicKey,
        userWitness: MerkleMapWitness,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        hashedPost: Field,
        postWitness: MerkleMapWitness,
        initialPostsNumber: Field,
        postState: PostState
      ) {
        const computedTransition = RollupTransition.createPostsTransition(
          signature,
          initialUsersRoot,
          latestUsersRoot,
          userAddress,
          userWitness,
          initialPostsRoot,
          latestPostsRoot,
          hashedPost,
          postWitness,
          initialPostsNumber,
          postState
        );
        RollupTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let PostsRollupProof_ = Experimental.ZkProgram.Proof(PostsRollup);
export class PostsRollupProof extends PostsRollupProof_ {}

// ============================================================================
