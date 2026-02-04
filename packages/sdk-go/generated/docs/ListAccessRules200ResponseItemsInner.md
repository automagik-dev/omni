# ListAccessRules200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Rule UUID | 
**InstanceId** | **NullableString** | Instance UUID (null for global) | 
**RuleType** | **string** | Rule type | 
**PhonePattern** | **NullableString** | Phone pattern | 
**PlatformUserId** | **NullableString** | Platform user ID | 
**PersonId** | **NullableString** | Person UUID | 
**Priority** | **int32** | Priority (higher &#x3D; checked first) | 
**Enabled** | **bool** | Whether enabled | 
**Reason** | **NullableString** | Reason | 
**ExpiresAt** | **NullableTime** | Expiration | 
**Action** | **string** | Action | 
**BlockMessage** | **NullableString** | Custom block message | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewListAccessRules200ResponseItemsInner

`func NewListAccessRules200ResponseItemsInner(id string, instanceId NullableString, ruleType string, phonePattern NullableString, platformUserId NullableString, personId NullableString, priority int32, enabled bool, reason NullableString, expiresAt NullableTime, action string, blockMessage NullableString, createdAt time.Time, updatedAt time.Time, ) *ListAccessRules200ResponseItemsInner`

NewListAccessRules200ResponseItemsInner instantiates a new ListAccessRules200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListAccessRules200ResponseItemsInnerWithDefaults

`func NewListAccessRules200ResponseItemsInnerWithDefaults() *ListAccessRules200ResponseItemsInner`

NewListAccessRules200ResponseItemsInnerWithDefaults instantiates a new ListAccessRules200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListAccessRules200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListAccessRules200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListAccessRules200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetInstanceId

`func (o *ListAccessRules200ResponseItemsInner) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *ListAccessRules200ResponseItemsInner) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *ListAccessRules200ResponseItemsInner) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### SetInstanceIdNil

`func (o *ListAccessRules200ResponseItemsInner) SetInstanceIdNil(b bool)`

 SetInstanceIdNil sets the value for InstanceId to be an explicit nil

### UnsetInstanceId
`func (o *ListAccessRules200ResponseItemsInner) UnsetInstanceId()`

UnsetInstanceId ensures that no value is present for InstanceId, not even an explicit nil
### GetRuleType

`func (o *ListAccessRules200ResponseItemsInner) GetRuleType() string`

GetRuleType returns the RuleType field if non-nil, zero value otherwise.

### GetRuleTypeOk

`func (o *ListAccessRules200ResponseItemsInner) GetRuleTypeOk() (*string, bool)`

GetRuleTypeOk returns a tuple with the RuleType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRuleType

`func (o *ListAccessRules200ResponseItemsInner) SetRuleType(v string)`

SetRuleType sets RuleType field to given value.


### GetPhonePattern

`func (o *ListAccessRules200ResponseItemsInner) GetPhonePattern() string`

GetPhonePattern returns the PhonePattern field if non-nil, zero value otherwise.

### GetPhonePatternOk

`func (o *ListAccessRules200ResponseItemsInner) GetPhonePatternOk() (*string, bool)`

GetPhonePatternOk returns a tuple with the PhonePattern field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhonePattern

`func (o *ListAccessRules200ResponseItemsInner) SetPhonePattern(v string)`

SetPhonePattern sets PhonePattern field to given value.


### SetPhonePatternNil

`func (o *ListAccessRules200ResponseItemsInner) SetPhonePatternNil(b bool)`

 SetPhonePatternNil sets the value for PhonePattern to be an explicit nil

### UnsetPhonePattern
`func (o *ListAccessRules200ResponseItemsInner) UnsetPhonePattern()`

UnsetPhonePattern ensures that no value is present for PhonePattern, not even an explicit nil
### GetPlatformUserId

`func (o *ListAccessRules200ResponseItemsInner) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *ListAccessRules200ResponseItemsInner) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *ListAccessRules200ResponseItemsInner) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### SetPlatformUserIdNil

`func (o *ListAccessRules200ResponseItemsInner) SetPlatformUserIdNil(b bool)`

 SetPlatformUserIdNil sets the value for PlatformUserId to be an explicit nil

### UnsetPlatformUserId
`func (o *ListAccessRules200ResponseItemsInner) UnsetPlatformUserId()`

UnsetPlatformUserId ensures that no value is present for PlatformUserId, not even an explicit nil
### GetPersonId

`func (o *ListAccessRules200ResponseItemsInner) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *ListAccessRules200ResponseItemsInner) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *ListAccessRules200ResponseItemsInner) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### SetPersonIdNil

`func (o *ListAccessRules200ResponseItemsInner) SetPersonIdNil(b bool)`

 SetPersonIdNil sets the value for PersonId to be an explicit nil

### UnsetPersonId
`func (o *ListAccessRules200ResponseItemsInner) UnsetPersonId()`

UnsetPersonId ensures that no value is present for PersonId, not even an explicit nil
### GetPriority

`func (o *ListAccessRules200ResponseItemsInner) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *ListAccessRules200ResponseItemsInner) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *ListAccessRules200ResponseItemsInner) SetPriority(v int32)`

SetPriority sets Priority field to given value.


### GetEnabled

`func (o *ListAccessRules200ResponseItemsInner) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *ListAccessRules200ResponseItemsInner) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *ListAccessRules200ResponseItemsInner) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetReason

`func (o *ListAccessRules200ResponseItemsInner) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *ListAccessRules200ResponseItemsInner) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *ListAccessRules200ResponseItemsInner) SetReason(v string)`

SetReason sets Reason field to given value.


### SetReasonNil

`func (o *ListAccessRules200ResponseItemsInner) SetReasonNil(b bool)`

 SetReasonNil sets the value for Reason to be an explicit nil

### UnsetReason
`func (o *ListAccessRules200ResponseItemsInner) UnsetReason()`

UnsetReason ensures that no value is present for Reason, not even an explicit nil
### GetExpiresAt

`func (o *ListAccessRules200ResponseItemsInner) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *ListAccessRules200ResponseItemsInner) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *ListAccessRules200ResponseItemsInner) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.


### SetExpiresAtNil

`func (o *ListAccessRules200ResponseItemsInner) SetExpiresAtNil(b bool)`

 SetExpiresAtNil sets the value for ExpiresAt to be an explicit nil

### UnsetExpiresAt
`func (o *ListAccessRules200ResponseItemsInner) UnsetExpiresAt()`

UnsetExpiresAt ensures that no value is present for ExpiresAt, not even an explicit nil
### GetAction

`func (o *ListAccessRules200ResponseItemsInner) GetAction() string`

GetAction returns the Action field if non-nil, zero value otherwise.

### GetActionOk

`func (o *ListAccessRules200ResponseItemsInner) GetActionOk() (*string, bool)`

GetActionOk returns a tuple with the Action field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAction

`func (o *ListAccessRules200ResponseItemsInner) SetAction(v string)`

SetAction sets Action field to given value.


### GetBlockMessage

`func (o *ListAccessRules200ResponseItemsInner) GetBlockMessage() string`

GetBlockMessage returns the BlockMessage field if non-nil, zero value otherwise.

### GetBlockMessageOk

`func (o *ListAccessRules200ResponseItemsInner) GetBlockMessageOk() (*string, bool)`

GetBlockMessageOk returns a tuple with the BlockMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBlockMessage

`func (o *ListAccessRules200ResponseItemsInner) SetBlockMessage(v string)`

SetBlockMessage sets BlockMessage field to given value.


### SetBlockMessageNil

`func (o *ListAccessRules200ResponseItemsInner) SetBlockMessageNil(b bool)`

 SetBlockMessageNil sets the value for BlockMessage to be an explicit nil

### UnsetBlockMessage
`func (o *ListAccessRules200ResponseItemsInner) UnsetBlockMessage()`

UnsetBlockMessage ensures that no value is present for BlockMessage, not even an explicit nil
### GetCreatedAt

`func (o *ListAccessRules200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListAccessRules200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListAccessRules200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *ListAccessRules200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *ListAccessRules200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *ListAccessRules200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


