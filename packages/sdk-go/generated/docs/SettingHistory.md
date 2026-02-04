# SettingHistory

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**OldValue** | **NullableString** | Old value (masked) | 
**NewValue** | **NullableString** | New value (masked) | 
**ChangedBy** | **string** | Who made the change | 
**ChangedAt** | **time.Time** | When changed | 
**ChangeReason** | **NullableString** | Reason for change | 

## Methods

### NewSettingHistory

`func NewSettingHistory(oldValue NullableString, newValue NullableString, changedBy string, changedAt time.Time, changeReason NullableString, ) *SettingHistory`

NewSettingHistory instantiates a new SettingHistory object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSettingHistoryWithDefaults

`func NewSettingHistoryWithDefaults() *SettingHistory`

NewSettingHistoryWithDefaults instantiates a new SettingHistory object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetOldValue

`func (o *SettingHistory) GetOldValue() string`

GetOldValue returns the OldValue field if non-nil, zero value otherwise.

### GetOldValueOk

`func (o *SettingHistory) GetOldValueOk() (*string, bool)`

GetOldValueOk returns a tuple with the OldValue field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOldValue

`func (o *SettingHistory) SetOldValue(v string)`

SetOldValue sets OldValue field to given value.


### SetOldValueNil

`func (o *SettingHistory) SetOldValueNil(b bool)`

 SetOldValueNil sets the value for OldValue to be an explicit nil

### UnsetOldValue
`func (o *SettingHistory) UnsetOldValue()`

UnsetOldValue ensures that no value is present for OldValue, not even an explicit nil
### GetNewValue

`func (o *SettingHistory) GetNewValue() string`

GetNewValue returns the NewValue field if non-nil, zero value otherwise.

### GetNewValueOk

`func (o *SettingHistory) GetNewValueOk() (*string, bool)`

GetNewValueOk returns a tuple with the NewValue field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNewValue

`func (o *SettingHistory) SetNewValue(v string)`

SetNewValue sets NewValue field to given value.


### SetNewValueNil

`func (o *SettingHistory) SetNewValueNil(b bool)`

 SetNewValueNil sets the value for NewValue to be an explicit nil

### UnsetNewValue
`func (o *SettingHistory) UnsetNewValue()`

UnsetNewValue ensures that no value is present for NewValue, not even an explicit nil
### GetChangedBy

`func (o *SettingHistory) GetChangedBy() string`

GetChangedBy returns the ChangedBy field if non-nil, zero value otherwise.

### GetChangedByOk

`func (o *SettingHistory) GetChangedByOk() (*string, bool)`

GetChangedByOk returns a tuple with the ChangedBy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangedBy

`func (o *SettingHistory) SetChangedBy(v string)`

SetChangedBy sets ChangedBy field to given value.


### GetChangedAt

`func (o *SettingHistory) GetChangedAt() time.Time`

GetChangedAt returns the ChangedAt field if non-nil, zero value otherwise.

### GetChangedAtOk

`func (o *SettingHistory) GetChangedAtOk() (*time.Time, bool)`

GetChangedAtOk returns a tuple with the ChangedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangedAt

`func (o *SettingHistory) SetChangedAt(v time.Time)`

SetChangedAt sets ChangedAt field to given value.


### GetChangeReason

`func (o *SettingHistory) GetChangeReason() string`

GetChangeReason returns the ChangeReason field if non-nil, zero value otherwise.

### GetChangeReasonOk

`func (o *SettingHistory) GetChangeReasonOk() (*string, bool)`

GetChangeReasonOk returns a tuple with the ChangeReason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangeReason

`func (o *SettingHistory) SetChangeReason(v string)`

SetChangeReason sets ChangeReason field to given value.


### SetChangeReasonNil

`func (o *SettingHistory) SetChangeReasonNil(b bool)`

 SetChangeReasonNil sets the value for ChangeReason to be an explicit nil

### UnsetChangeReason
`func (o *SettingHistory) UnsetChangeReason()`

UnsetChangeReason ensures that no value is present for ChangeReason, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


