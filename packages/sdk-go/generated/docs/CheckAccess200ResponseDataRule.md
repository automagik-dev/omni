# CheckAccess200ResponseDataRule

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

### NewCheckAccess200ResponseDataRule

`func NewCheckAccess200ResponseDataRule(id string, instanceId NullableString, ruleType string, phonePattern NullableString, platformUserId NullableString, personId NullableString, priority int32, enabled bool, reason NullableString, expiresAt NullableTime, action string, blockMessage NullableString, createdAt time.Time, updatedAt time.Time, ) *CheckAccess200ResponseDataRule`

NewCheckAccess200ResponseDataRule instantiates a new CheckAccess200ResponseDataRule object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCheckAccess200ResponseDataRuleWithDefaults

`func NewCheckAccess200ResponseDataRuleWithDefaults() *CheckAccess200ResponseDataRule`

NewCheckAccess200ResponseDataRuleWithDefaults instantiates a new CheckAccess200ResponseDataRule object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *CheckAccess200ResponseDataRule) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *CheckAccess200ResponseDataRule) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *CheckAccess200ResponseDataRule) SetId(v string)`

SetId sets Id field to given value.


### GetInstanceId

`func (o *CheckAccess200ResponseDataRule) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *CheckAccess200ResponseDataRule) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *CheckAccess200ResponseDataRule) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### SetInstanceIdNil

`func (o *CheckAccess200ResponseDataRule) SetInstanceIdNil(b bool)`

 SetInstanceIdNil sets the value for InstanceId to be an explicit nil

### UnsetInstanceId
`func (o *CheckAccess200ResponseDataRule) UnsetInstanceId()`

UnsetInstanceId ensures that no value is present for InstanceId, not even an explicit nil
### GetRuleType

`func (o *CheckAccess200ResponseDataRule) GetRuleType() string`

GetRuleType returns the RuleType field if non-nil, zero value otherwise.

### GetRuleTypeOk

`func (o *CheckAccess200ResponseDataRule) GetRuleTypeOk() (*string, bool)`

GetRuleTypeOk returns a tuple with the RuleType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRuleType

`func (o *CheckAccess200ResponseDataRule) SetRuleType(v string)`

SetRuleType sets RuleType field to given value.


### GetPhonePattern

`func (o *CheckAccess200ResponseDataRule) GetPhonePattern() string`

GetPhonePattern returns the PhonePattern field if non-nil, zero value otherwise.

### GetPhonePatternOk

`func (o *CheckAccess200ResponseDataRule) GetPhonePatternOk() (*string, bool)`

GetPhonePatternOk returns a tuple with the PhonePattern field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhonePattern

`func (o *CheckAccess200ResponseDataRule) SetPhonePattern(v string)`

SetPhonePattern sets PhonePattern field to given value.


### SetPhonePatternNil

`func (o *CheckAccess200ResponseDataRule) SetPhonePatternNil(b bool)`

 SetPhonePatternNil sets the value for PhonePattern to be an explicit nil

### UnsetPhonePattern
`func (o *CheckAccess200ResponseDataRule) UnsetPhonePattern()`

UnsetPhonePattern ensures that no value is present for PhonePattern, not even an explicit nil
### GetPlatformUserId

`func (o *CheckAccess200ResponseDataRule) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *CheckAccess200ResponseDataRule) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *CheckAccess200ResponseDataRule) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### SetPlatformUserIdNil

`func (o *CheckAccess200ResponseDataRule) SetPlatformUserIdNil(b bool)`

 SetPlatformUserIdNil sets the value for PlatformUserId to be an explicit nil

### UnsetPlatformUserId
`func (o *CheckAccess200ResponseDataRule) UnsetPlatformUserId()`

UnsetPlatformUserId ensures that no value is present for PlatformUserId, not even an explicit nil
### GetPersonId

`func (o *CheckAccess200ResponseDataRule) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *CheckAccess200ResponseDataRule) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *CheckAccess200ResponseDataRule) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### SetPersonIdNil

`func (o *CheckAccess200ResponseDataRule) SetPersonIdNil(b bool)`

 SetPersonIdNil sets the value for PersonId to be an explicit nil

### UnsetPersonId
`func (o *CheckAccess200ResponseDataRule) UnsetPersonId()`

UnsetPersonId ensures that no value is present for PersonId, not even an explicit nil
### GetPriority

`func (o *CheckAccess200ResponseDataRule) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *CheckAccess200ResponseDataRule) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *CheckAccess200ResponseDataRule) SetPriority(v int32)`

SetPriority sets Priority field to given value.


### GetEnabled

`func (o *CheckAccess200ResponseDataRule) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *CheckAccess200ResponseDataRule) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *CheckAccess200ResponseDataRule) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetReason

`func (o *CheckAccess200ResponseDataRule) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *CheckAccess200ResponseDataRule) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *CheckAccess200ResponseDataRule) SetReason(v string)`

SetReason sets Reason field to given value.


### SetReasonNil

`func (o *CheckAccess200ResponseDataRule) SetReasonNil(b bool)`

 SetReasonNil sets the value for Reason to be an explicit nil

### UnsetReason
`func (o *CheckAccess200ResponseDataRule) UnsetReason()`

UnsetReason ensures that no value is present for Reason, not even an explicit nil
### GetExpiresAt

`func (o *CheckAccess200ResponseDataRule) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *CheckAccess200ResponseDataRule) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *CheckAccess200ResponseDataRule) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.


### SetExpiresAtNil

`func (o *CheckAccess200ResponseDataRule) SetExpiresAtNil(b bool)`

 SetExpiresAtNil sets the value for ExpiresAt to be an explicit nil

### UnsetExpiresAt
`func (o *CheckAccess200ResponseDataRule) UnsetExpiresAt()`

UnsetExpiresAt ensures that no value is present for ExpiresAt, not even an explicit nil
### GetAction

`func (o *CheckAccess200ResponseDataRule) GetAction() string`

GetAction returns the Action field if non-nil, zero value otherwise.

### GetActionOk

`func (o *CheckAccess200ResponseDataRule) GetActionOk() (*string, bool)`

GetActionOk returns a tuple with the Action field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAction

`func (o *CheckAccess200ResponseDataRule) SetAction(v string)`

SetAction sets Action field to given value.


### GetBlockMessage

`func (o *CheckAccess200ResponseDataRule) GetBlockMessage() string`

GetBlockMessage returns the BlockMessage field if non-nil, zero value otherwise.

### GetBlockMessageOk

`func (o *CheckAccess200ResponseDataRule) GetBlockMessageOk() (*string, bool)`

GetBlockMessageOk returns a tuple with the BlockMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBlockMessage

`func (o *CheckAccess200ResponseDataRule) SetBlockMessage(v string)`

SetBlockMessage sets BlockMessage field to given value.


### SetBlockMessageNil

`func (o *CheckAccess200ResponseDataRule) SetBlockMessageNil(b bool)`

 SetBlockMessageNil sets the value for BlockMessage to be an explicit nil

### UnsetBlockMessage
`func (o *CheckAccess200ResponseDataRule) UnsetBlockMessage()`

UnsetBlockMessage ensures that no value is present for BlockMessage, not even an explicit nil
### GetCreatedAt

`func (o *CheckAccess200ResponseDataRule) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *CheckAccess200ResponseDataRule) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *CheckAccess200ResponseDataRule) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *CheckAccess200ResponseDataRule) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *CheckAccess200ResponseDataRule) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *CheckAccess200ResponseDataRule) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


