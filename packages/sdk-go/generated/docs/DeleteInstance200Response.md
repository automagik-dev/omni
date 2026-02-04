# DeleteInstance200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Success** | **bool** | Operation succeeded | 
**Message** | Pointer to **string** | Optional success message | [optional] 

## Methods

### NewDeleteInstance200Response

`func NewDeleteInstance200Response(success bool, ) *DeleteInstance200Response`

NewDeleteInstance200Response instantiates a new DeleteInstance200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewDeleteInstance200ResponseWithDefaults

`func NewDeleteInstance200ResponseWithDefaults() *DeleteInstance200Response`

NewDeleteInstance200ResponseWithDefaults instantiates a new DeleteInstance200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSuccess

`func (o *DeleteInstance200Response) GetSuccess() bool`

GetSuccess returns the Success field if non-nil, zero value otherwise.

### GetSuccessOk

`func (o *DeleteInstance200Response) GetSuccessOk() (*bool, bool)`

GetSuccessOk returns a tuple with the Success field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSuccess

`func (o *DeleteInstance200Response) SetSuccess(v bool)`

SetSuccess sets Success field to given value.


### GetMessage

`func (o *DeleteInstance200Response) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *DeleteInstance200Response) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *DeleteInstance200Response) SetMessage(v string)`

SetMessage sets Message field to given value.

### HasMessage

`func (o *DeleteInstance200Response) HasMessage() bool`

HasMessage returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


