# ConnectInstance200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance UUID | 
**status** | **str** | Connection status | 
**message** | **str** | Status message | 

## Example

```python
from omni_generated.models.connect_instance200_response_data import ConnectInstance200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of ConnectInstance200ResponseData from a JSON string
connect_instance200_response_data_instance = ConnectInstance200ResponseData.from_json(json)
# print the JSON string representation of the object
print(ConnectInstance200ResponseData.to_json())

# convert the object into a dict
connect_instance200_response_data_dict = connect_instance200_response_data_instance.to_dict()
# create an instance of ConnectInstance200ResponseData from a dict
connect_instance200_response_data_from_dict = ConnectInstance200ResponseData.from_dict(connect_instance200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


