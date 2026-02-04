# ListSettings200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Key** | **string** | Setting key | 
**Value** | Pointer to **interface{}** | Setting value (masked if secret) | [optional] 
**Category** | **NullableString** | Category | 
**IsSecret** | **bool** | Whether value is secret | 
**Description** | **NullableString** | Description | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewListSettings200ResponseItemsInner

`func NewListSettings200ResponseItemsInner(key string, category NullableString, isSecret bool, description NullableString, createdAt time.Time, updatedAt time.Time, ) *ListSettings200ResponseItemsInner`

NewListSettings200ResponseItemsInner instantiates a new ListSettings200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListSettings200ResponseItemsInnerWithDefaults

`func NewListSettings200ResponseItemsInnerWithDefaults() *ListSettings200ResponseItemsInner`

NewListSettings200ResponseItemsInnerWithDefaults instantiates a new ListSettings200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetKey

`func (o *ListSettings200ResponseItemsInner) GetKey() string`

GetKey returns the Key field if non-nil, zero value otherwise.

### GetKeyOk

`func (o *ListSettings200ResponseItemsInner) GetKeyOk() (*string, bool)`

GetKeyOk returns a tuple with the Key field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetKey

`func (o *ListSettings200ResponseItemsInner) SetKey(v string)`

SetKey sets Key field to given value.


### GetValue

`func (o *ListSettings200ResponseItemsInner) GetValue() interface{}`

GetValue returns the Value field if non-nil, zero value otherwise.

### GetValueOk

`func (o *ListSettings200ResponseItemsInner) GetValueOk() (*interface{}, bool)`

GetValueOk returns a tuple with the Value field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetValue

`func (o *ListSettings200ResponseItemsInner) SetValue(v interface{})`

SetValue sets Value field to given value.

### HasValue

`func (o *ListSettings200ResponseItemsInner) HasValue() bool`

HasValue returns a boolean if a field has been set.

### SetValueNil

`func (o *ListSettings200ResponseItemsInner) SetValueNil(b bool)`

 SetValueNil sets the value for Value to be an explicit nil

### UnsetValue
`func (o *ListSettings200ResponseItemsInner) UnsetValue()`

UnsetValue ensures that no value is present for Value, not even an explicit nil
### GetCategory

`func (o *ListSettings200ResponseItemsInner) GetCategory() string`

GetCategory returns the Category field if non-nil, zero value otherwise.

### GetCategoryOk

`func (o *ListSettings200ResponseItemsInner) GetCategoryOk() (*string, bool)`

GetCategoryOk returns a tuple with the Category field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCategory

`func (o *ListSettings200ResponseItemsInner) SetCategory(v string)`

SetCategory sets Category field to given value.


### SetCategoryNil

`func (o *ListSettings200ResponseItemsInner) SetCategoryNil(b bool)`

 SetCategoryNil sets the value for Category to be an explicit nil

### UnsetCategory
`func (o *ListSettings200ResponseItemsInner) UnsetCategory()`

UnsetCategory ensures that no value is present for Category, not even an explicit nil
### GetIsSecret

`func (o *ListSettings200ResponseItemsInner) GetIsSecret() bool`

GetIsSecret returns the IsSecret field if non-nil, zero value otherwise.

### GetIsSecretOk

`func (o *ListSettings200ResponseItemsInner) GetIsSecretOk() (*bool, bool)`

GetIsSecretOk returns a tuple with the IsSecret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsSecret

`func (o *ListSettings200ResponseItemsInner) SetIsSecret(v bool)`

SetIsSecret sets IsSecret field to given value.


### GetDescription

`func (o *ListSettings200ResponseItemsInner) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *ListSettings200ResponseItemsInner) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *ListSettings200ResponseItemsInner) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *ListSettings200ResponseItemsInner) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *ListSettings200ResponseItemsInner) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetCreatedAt

`func (o *ListSettings200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListSettings200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListSettings200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *ListSettings200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *ListSettings200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *ListSettings200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


