import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  MerkleMapWitness,
  Bool,
} from 'o1js';
import { PostState } from '../posts/Posts.js';

// ============================================================================

export const fieldToFlagTargetAsReposted = Field(2222);

// ============================================================================

export class RepostState extends Struct({
  isTargetPost: Bool,
  targetKey: Field,
  reposterAddress: PublicKey,
  allRepostsCounter: Field,
  userRepostsCounter: Field,
  targetRepostsCounter: Field,
  repostBlockHeight: Field,
  deletionBlockHeight: Field,
  restorationBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.isTargetPost
        .toFields()
        .concat(
          this.targetKey,
          this.reposterAddress
            .toFields()
            .concat([
              this.allRepostsCounter,
              this.userRepostsCounter,
              this.targetRepostsCounter,
              this.repostBlockHeight,
              this.deletionBlockHeight,
              this.restorationBlockHeight,
            ])
        )
    );
  }
}

// ============================================================================

export class RepostsTransition extends Struct({
  targets: Field,
  initialAllRepostsCounter: Field,
  latestAllRepostsCounter: Field,
  initialUsersRepostsCounters: Field,
  latestUsersRepostsCounters: Field,
  initialTargetsRepostsCounters: Field,
  latestTargetsRepostsCounters: Field,
  initialReposts: Field,
  latestReposts: Field,
  blockHeight: Field,
}) {
  static createRepostPublishingTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    initialAllRepostsCounter: Field,
    initialUsersRepostsCounters: Field,
    latestUsersRepostsCounters: Field,
    initialUserRepostsCounter: Field,
    userRepostsCounterWitness: MerkleMapWitness,
    initialTargetsRepostsCounters: Field,
    latestTargetsRepostsCounters: Field,
    initialTargetRepostsCounter: Field,
    targetRepostsCounterWitness: MerkleMapWitness,
    initialReposts: Field,
    latestReposts: Field,
    repostWitness: MerkleMapWitness,
    repostState: RepostState
  ) {
    initialAllRepostsCounter.assertEquals(repostState.allRepostsCounter.sub(1));
    repostState.deletionBlockHeight.assertEquals(Field(0));
    repostState.restorationBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKey(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(repostState.targetKey);

    const isSigned = signature.verify(repostState.reposterAddress, [
      targetKey,
      fieldToFlagTargetAsReposted,
    ]);
    isSigned.assertTrue();

    const [usersRepostsCountersBefore, userRepostsCounterKey] =
      userRepostsCounterWitness.computeRootAndKey(initialUserRepostsCounter);
    usersRepostsCountersBefore.assertEquals(initialUsersRepostsCounters);
    const reposterAddressAsField = Poseidon.hash(
      repostState.reposterAddress.toFields()
    );
    userRepostsCounterKey.assertEquals(reposterAddressAsField);
    initialUserRepostsCounter.assertEquals(
      repostState.userRepostsCounter.sub(1)
    );
    const usersRepostsCountersAfter =
      userRepostsCounterWitness.computeRootAndKey(
        repostState.userRepostsCounter
      )[0];
    usersRepostsCountersAfter.assertEquals(latestUsersRepostsCounters);

    const [targetsRepostsCountersBefore, targetRepostsCounterKey] =
      targetRepostsCounterWitness.computeRootAndKey(
        initialTargetRepostsCounter
      );
    targetsRepostsCountersBefore.assertEquals(initialTargetsRepostsCounters);
    targetRepostsCounterKey.assertEquals(targetKey);
    initialTargetRepostsCounter.assertEquals(
      repostState.targetRepostsCounter.sub(1)
    );
    const targetsRepostsCountersAfter =
      targetRepostsCounterWitness.computeRootAndKey(
        repostState.targetRepostsCounter
      )[0];
    targetsRepostsCountersAfter.assertEquals(latestTargetsRepostsCounters);

    const [repostsBefore, repostKey] = repostWitness.computeRootAndKey(
      Field(0)
    );
    repostsBefore.assertEquals(initialReposts);
    repostKey.assertEquals(Poseidon.hash([targetKey, reposterAddressAsField]));
    const repostsAfter = repostWitness.computeRootAndKey(repostState.hash())[0];
    repostsAfter.assertEquals(latestReposts);

    return new RepostsTransition({
      targets: targetsRoot,
      initialAllRepostsCounter: initialAllRepostsCounter,
      latestAllRepostsCounter: repostState.allRepostsCounter,
      initialUsersRepostsCounters: usersRepostsCountersBefore,
      latestUsersRepostsCounters: usersRepostsCountersAfter,
      initialTargetsRepostsCounters: targetsRepostsCountersBefore,
      latestTargetsRepostsCounters: targetsRepostsCountersAfter,
      initialReposts: repostsBefore,
      latestReposts: repostsAfter,
      blockHeight: repostState.repostBlockHeight,
    });
  }

  static assertEquals(
    transition1: RepostsTransition,
    transition2: RepostsTransition
  ) {
    transition1.initialAllRepostsCounter.assertEquals(
      transition2.initialAllRepostsCounter
    );
    transition1.latestAllRepostsCounter.assertEquals(
      transition2.latestAllRepostsCounter
    );
    transition1.initialUsersRepostsCounters.assertEquals(
      transition2.initialUsersRepostsCounters
    );
    transition1.latestUsersRepostsCounters.assertEquals(
      transition2.latestUsersRepostsCounters
    );
    transition1.initialTargetsRepostsCounters.assertEquals(
      transition2.initialTargetsRepostsCounters
    );
    transition1.latestTargetsRepostsCounters.assertEquals(
      transition2.latestTargetsRepostsCounters
    );
    transition1.initialReposts.assertEquals(transition2.initialReposts);
    transition1.latestReposts.assertEquals(transition2.latestReposts);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }
}

// ============================================================================

export const Reposts = ZkProgram({
  name: 'Reposts',
  publicInput: RepostsTransition,

  methods: {
    proveRepostPublishingTransition: {
      privateInputs: [
        Signature,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        MerkleMapWitness,
        RepostState,
      ],

      method(
        transition: RepostsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        initialAllRepostsCounter: Field,
        initialUsersRepostsCounters: Field,
        latestUsersRepostsCounters: Field,
        initialUserRepostsCounter: Field,
        userRepostsCounterWitness: MerkleMapWitness,
        initialTargetsRepostsCounters: Field,
        latestTargetsRepostsCounters: Field,
        initialTargetRepostsCounter: Field,
        targetRepostsCounterWitness: MerkleMapWitness,
        initialReposts: Field,
        latestReposts: Field,
        repostWitness: MerkleMapWitness,
        repostState: RepostState
      ) {
        const computedTransition =
          RepostsTransition.createRepostPublishingTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            initialAllRepostsCounter,
            initialUsersRepostsCounters,
            latestUsersRepostsCounters,
            initialUserRepostsCounter,
            userRepostsCounterWitness,
            initialTargetsRepostsCounters,
            latestTargetsRepostsCounters,
            initialTargetRepostsCounter,
            targetRepostsCounterWitness,
            initialReposts,
            latestReposts,
            repostWitness,
            repostState
          );
        RepostsTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let RepostsProof_ = ZkProgram.Proof(Reposts);
export class RepostsProof extends RepostsProof_ {}

// ============================================================================
