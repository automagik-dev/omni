# ListWebhookSources200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Source UUID | 
**Name** | **string** | Source name | 
**Description** | **NullableString** | Description | 
**ExpectedHeaders** | **map[string]bool** | Expected headers | 
**Enabled** | **bool** | Whether enabled | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewListWebhookSources200ResponseItemsInner

`func NewListWebhookSources200ResponseItemsInner(id string, name string, description NullableString, expectedHeaders map[string]bool, enabled bool, createdAt time.Time, updatedAt time.Time, ) *ListWebhookSources200ResponseItemsInner`

NewListWebhookSources200ResponseItemsInner instantiates a new ListWebhookSources200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListWebhookSources200ResponseItemsInnerWithDefaults

`func NewListWebhookSources200ResponseItemsInnerWithDefaults() *ListWebhookSources200ResponseItemsInner`

NewListWebhookSources200ResponseItemsInnerWithDefaults instantiates a new ListWebhookSources200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListWebhookSources200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListWebhookSources200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListWebhookSources200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *ListWebhookSources200ResponseItemsInner) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ListWebhookSources200ResponseItemsInner) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ListWebhookSources200ResponseItemsInner) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *ListWebhookSources200ResponseItemsInner) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *ListWebhookSources200ResponseItemsInner) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *ListWebhookSources200ResponseItemsInner) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *ListWebhookSources200ResponseItemsInner) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *ListWebhookSources200ResponseItemsInner) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetExpectedHeaders

`func (o *ListWebhookSources200ResponseItemsInner) GetExpectedHeaders() map[string]bool`

GetExpectedHeaders returns the ExpectedHeaders field if non-nil, zero value otherwise.

### GetExpectedHeadersOk

`func (o *ListWebhookSources200ResponseItemsInner) GetExpectedHeadersOk() (*map[string]bool, bool)`

GetExpectedHeadersOk returns a tuple with the ExpectedHeaders field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpectedHeaders

`func (o *ListWebhookSources200ResponseItemsInner) SetExpectedHeaders(v map[string]bool)`

SetExpectedHeaders sets ExpectedHeaders field to given value.


### SetExpectedHeadersNil

`func (o *ListWebhookSources200ResponseItemsInner) SetExpectedHeadersNil(b bool)`

 SetExpectedHeadersNil sets the value for ExpectedHeaders to be an explicit nil

### UnsetExpectedHeaders
`func (o *ListWebhookSources200ResponseItemsInner) UnsetExpectedHeaders()`

UnsetExpectedHeaders ensures that no value is present for ExpectedHeaders, not even an explicit nil
### GetEnabled

`func (o *ListWebhookSources200ResponseItemsInner) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *ListWebhookSources200ResponseItemsInner) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *ListWebhookSources200ResponseItemsInner) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetCreatedAt

`func (o *ListWebhookSources200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListWebhookSources200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListWebhookSources200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *ListWebhookSources200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *ListWebhookSources200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *ListWebhookSources200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


